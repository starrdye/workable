/**
 * agents/nodeAgent.ts — Per-node autonomous AI agent.
 * Phase 2: Node-as-an-Agent architecture.
 *
 * Each node in the workflow graph becomes an agent with its own ego-centric
 * context. The agent uses LLM reasoning to analyse its position, constraints,
 * and connections, then produces typed actions and optional messages to
 * neighbouring agents.
 */

import { generateText, type AIProviderConfig } from '../aiClient';
import type { AgentContext, AgentResponse, AgentAction, AgentMessage } from './types';

// ── System Prompt ────────────────────────────────────────────────────────────

function buildSystemPrompt(ctx: AgentContext): string {
  return `You are an autonomous agent representing the workflow node "${ctx.nodeName}".

ROLE: ${ctx.role}
SUMMARY: ${ctx.summary || 'No summary provided.'}
${ctx.constraints ? `CONSTRAINTS: ${ctx.constraints}` : ''}

YOUR TASKS:
${ctx.tasks.length > 0
    ? ctx.tasks.map(t => `- [${t.status}] ${t.title} (${t.priority} priority)${t.note ? `: ${t.note}` : ''}`).join('\n')
    : '- No explicit tasks assigned.'}

INBOUND CONNECTIONS (who sends work to you):
${ctx.inboundEdges.length > 0
    ? ctx.inboundEdges.map(e => `← ${e.fromName} via "${e.edgeName}" (weight: ${e.weight})`).join('\n')
    : '- No inbound connections.'}

OUTBOUND CONNECTIONS (who you send work to):
${ctx.outboundEdges.length > 0
    ? ctx.outboundEdges.map(e => `→ ${e.toName} via "${e.edgeName}" (weight: ${e.weight})`).join('\n')
    : '- No outbound connections.'}

GROUP MEMBERSHIPS:
${ctx.groupMemberships.length > 0
    ? ctx.groupMemberships.map(g => `- "${g.groupName}" (peers: ${g.peerNodeIds.length})`).join('\n')
    : '- Not in any group.'}

NEIGHBOURS:
${ctx.neighborSummaries.map(n => `- ${n.name} (${n.role}): ${n.summary}`).join('\n')}

You must analyse your position in the workflow and suggest improvements.
Think about: Am I a bottleneck? Are there redundant connections? Could tasks be delegated?

Respond ONLY with valid JSON matching this schema:
{
  "analysis": "Your analysis of your position and efficiency (2-4 sentences)",
  "suggestedActions": [
    {
      "type": "add_edge" | "remove_edge" | "flag_bottleneck" | "flag_orphan" | "delegate_task" | "propose_optimization" | "no_action",
      "description": "What the action does",
      "targetNodeId": "optional node ID",
      "edgeId": "optional edge ID",
      "reason": "Why this action would help"
    }
  ],
  "messagesToNeighbours": [
    {
      "toNodeId": "target node ID",
      "type": "REROUTE_REQUEST" | "NEW_EDGE_PROPOSED" | "BOTTLENECK_DETECTED" | "ORPHAN_WARNING",
      "content": "Message content"
    }
  ]
}`;
}

// ── User Message ─────────────────────────────────────────────────────────────

function buildUserMessage(ctx: AgentContext, additionalContext?: string): string {
  let msg = `Analyse your position as "${ctx.nodeName}" in this workflow. `;
  msg += `You have ${ctx.inboundEdges.length} inbound and ${ctx.outboundEdges.length} outbound connections. `;

  if (ctx.constraints) {
    msg += `Your operational constraints are: ${ctx.constraints}. `;
  }

  if (ctx.tasks.length > 0) {
    const blocked = ctx.tasks.filter(t => t.status === 'blocked').length;
    const inProgress = ctx.tasks.filter(t => t.status === 'in-progress').length;
    msg += `You have ${ctx.tasks.length} tasks (${inProgress} in progress, ${blocked} blocked). `;
  }

  if (additionalContext) {
    msg += `\n\nAdditional context: ${additionalContext}`;
  }

  msg += '\n\nProvide your analysis and any suggested actions as JSON.';
  return msg;
}

// ── Response Parser ──────────────────────────────────────────────────────────

interface RawAgentResponse {
  analysis: string;
  suggestedActions: Array<{
    type: string;
    description: string;
    targetNodeId?: string;
    edgeId?: string;
    reason: string;
  }>;
  messagesToNeighbours?: Array<{
    toNodeId: string;
    type: string;
    content: string;
  }>;
}

function parseAgentResponse(text: string, ctx: AgentContext): { actions: AgentAction[]; messages: AgentMessage[]; analysis: string } {
  // Strip markdown code fences if present
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  }

  try {
    const raw: RawAgentResponse = JSON.parse(cleaned);

    const actions: AgentAction[] = (raw.suggestedActions ?? []).map(a => ({
      type: a.type as AgentAction['type'],
      description: a.description ?? '',
      targetNodeId: a.targetNodeId,
      edgeId: a.edgeId,
      reason: a.reason ?? '',
    }));

    const messages: AgentMessage[] = (raw.messagesToNeighbours ?? []).map((m, i) => ({
      id: `${ctx.nodeId}-msg-${i}-${Date.now()}`,
      fromNodeId: ctx.nodeId,
      toNodeId: m.toNodeId,
      type: m.type as AgentMessage['type'],
      content: m.content,
      timestamp: Date.now(),
      depth: 0,
    }));

    return { actions, messages, analysis: raw.analysis ?? 'No analysis provided.' };
  } catch {
    // If JSON parse fails, treat the whole response as a text analysis
    return {
      analysis: text,
      actions: [{ type: 'no_action', description: 'Could not parse structured response', reason: text }],
      messages: [],
    };
  }
}

// ── NodeAgent Class ──────────────────────────────────────────────────────────

export class NodeAgent {
  readonly context: AgentContext;
  private readonly aiConfig: AIProviderConfig;

  constructor(context: AgentContext, aiConfig: AIProviderConfig) {
    this.context = context;
    this.aiConfig = aiConfig;
  }

  /**
   * Run the agent's analysis. Returns structured response with actions and messages.
   */
  async think(additionalContext?: string): Promise<AgentResponse> {
    const systemPrompt = buildSystemPrompt(this.context);
    const userMessage = buildUserMessage(this.context, additionalContext);

    const result = await generateText({
      provider: this.aiConfig.provider,
      model: this.aiConfig.model,
      apiKey: this.aiConfig.apiKey,
      systemPrompt,
      userMessage,
      maxTokens: 1024,
      baseUrl: this.aiConfig.baseUrl,
    });

    const parsed = parseAgentResponse(result.text, this.context);

    return {
      nodeId: this.context.nodeId,
      nodeName: this.context.nodeName,
      analysis: parsed.analysis,
      suggestedActions: parsed.actions,
      messagesOut: parsed.messages,
      tokenUsage: result.usage ? { input: result.usage.inputTokens, output: result.usage.outputTokens } : undefined,
    };
  }

  /**
   * Process an incoming message from another agent and produce a response.
   * Used in Phase 3 cascade simulation.
   */
  async processMessage(message: AgentMessage): Promise<AgentResponse> {
    const additionalContext = `You received a message from node "${message.fromNodeId}": [${message.type}] ${message.content}. How does this affect you? What action should you take?`;
    return this.think(additionalContext);
  }
}
