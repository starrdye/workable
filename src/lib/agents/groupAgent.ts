/**
 * agents/groupAgent.ts — Per-group governance AI agent.
 * Phase 4: Group-level governance.
 *
 * Instead of spawning an LLM agent for every node (expensive at scale),
 * group agents provide a middle ground: one agent per WorkflowGroup,
 * overseeing all internal nodes and boundary connections.
 */

import { generateText, type AIProviderConfig } from '../aiClient';
import type { GroupContext, GroupAnalysis, GroupNegotiation, AgentAction } from './types';

// ── System Prompt ────────────────────────────────────────────────────────────

function buildGroupSystemPrompt(ctx: GroupContext): string {
  const memberList = ctx.memberNodes
    .map(n => `  - ${n.nodeName} (${n.role})${n.constraints ? ` [Constrained: ${n.constraints}]` : ''}`)
    .join('\n');

  const boundaryList = ctx.boundaryEdges
    .map(b => `  ${b.direction === 'inbound' ? '←' : '→'} ${b.externalNodeName} (${b.externalNodeRole}) via edge "${b.edgeId}"`)
    .join('\n');

  const adjacentList = ctx.adjacentGroupSummaries
    .map(g => `  - "${g.groupName}": ${g.nodeCount} nodes, ${g.edgeCount} edges, roles: ${g.roleSummary}`)
    .join('\n');

  return `You are the governance agent for the "${ctx.groupName}" team (group ID: ${ctx.groupId}).

YOUR TEAM (${ctx.memberNodes.length} members):
${memberList || '  (no members)'}

INTERNAL CONNECTIONS:
${ctx.memberNodes.flatMap(n => [
  ...n.inboundEdges
    .filter(e => ctx.memberNodes.some(m => m.nodeId === e.fromId))
    .map(e => `  ${e.fromName} → ${n.nodeName} via "${e.edgeName}" (weight: ${e.weight})`),
  ...n.outboundEdges
    .filter(e => ctx.memberNodes.some(m => m.nodeId === e.toId))
    .map(e => `  ${n.nodeName} → ${e.toName} via "${e.edgeName}" (weight: ${e.weight})`),
]).filter((v, i, a) => a.indexOf(v) === i).join('\n') || '  (no internal connections)'}

BOUNDARY CONNECTIONS (to/from other groups):
${boundaryList || '  (no boundary connections)'}

ADJACENT GROUPS:
${adjacentList || '  (no adjacent groups)'}

${ctx.subgroups.length > 0 ? `SUBGROUPS:\n${ctx.subgroups.map(s => `  - "${s.name}" (${s.nodeCount} nodes)`).join('\n')}` : ''}
${ctx.parentGroup ? `PARENT GROUP: "${ctx.parentGroup.name}" (${ctx.parentGroup.id})` : ''}

Analyse your team's internal efficiency and boundary interactions.
Consider: bottlenecks within the team, redundant internal edges, missing connections,
and whether any cross-group proposals would improve the workflow.

Respond ONLY with valid JSON:
{
  "analysis": "Overall assessment of the group (3-5 sentences)",
  "internalOptimizations": [
    {
      "type": "add_edge" | "remove_edge" | "flag_bottleneck" | "delegate_task" | "propose_optimization" | "no_action",
      "description": "What to do",
      "targetNodeId": "optional",
      "edgeId": "optional",
      "reason": "Why"
    }
  ],
  "boundaryProposals": [
    {
      "targetGroupId": "group ID",
      "proposalType": "add_edge" | "remove_edge" | "modify_edge" | "move_node",
      "description": "What to change",
      "affectedNodeIds": ["node IDs"],
      "reason": "Why this improves the workflow"
    }
  ],
  "bottleneckNodes": ["node IDs of bottlenecks within the group"],
  "redundantEdges": ["edge IDs that are redundant"]
}`;
}

// ── Response Parser ──────────────────────────────────────────────────────────

interface RawGroupResponse {
  analysis: string;
  internalOptimizations?: Array<{
    type: string; description: string;
    targetNodeId?: string; edgeId?: string; reason: string;
  }>;
  boundaryProposals?: Array<{
    targetGroupId: string; proposalType: string;
    description: string; affectedNodeIds: string[]; reason: string;
  }>;
  bottleneckNodes?: string[];
  redundantEdges?: string[];
}

function parseGroupResponse(
  text: string,
  ctx: GroupContext,
  tokenUsage: { input: number; output: number },
): GroupAnalysis {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  }

  try {
    const raw: RawGroupResponse = JSON.parse(cleaned);

    return {
      groupId: ctx.groupId,
      groupName: ctx.groupName,
      analysis: raw.analysis ?? 'No analysis provided.',
      internalOptimizations: (raw.internalOptimizations ?? []).map(a => ({
        type: a.type as AgentAction['type'],
        description: a.description ?? '',
        targetNodeId: a.targetNodeId,
        edgeId: a.edgeId,
        reason: a.reason ?? '',
      })),
      boundaryProposals: (raw.boundaryProposals ?? []).map(p => ({
        proposingGroupId: ctx.groupId,
        targetGroupId: p.targetGroupId,
        proposalType: p.proposalType as GroupNegotiation['proposalType'],
        description: p.description ?? '',
        affectedNodeIds: p.affectedNodeIds ?? [],
        reason: p.reason ?? '',
      })),
      bottleneckNodes: raw.bottleneckNodes ?? [],
      redundantEdges: raw.redundantEdges ?? [],
      tokenUsage,
    };
  } catch {
    return {
      groupId: ctx.groupId,
      groupName: ctx.groupName,
      analysis: text,
      internalOptimizations: [],
      boundaryProposals: [],
      bottleneckNodes: [],
      redundantEdges: [],
      tokenUsage,
    };
  }
}

// ── GroupAgent Class ─────────────────────────────────────────────────────────

export class GroupAgent {
  readonly context: GroupContext;
  private readonly aiConfig: AIProviderConfig;

  constructor(context: GroupContext, aiConfig: AIProviderConfig) {
    this.context = context;
    this.aiConfig = aiConfig;
  }

  /**
   * Run the group-level analysis.
   */
  async analyze(): Promise<GroupAnalysis> {
    const systemPrompt = buildGroupSystemPrompt(this.context);
    const userMessage = `Analyse the "${this.context.groupName}" team (${this.context.memberNodes.length} members, ${this.context.boundaryEdges.length} boundary connections). Identify internal bottlenecks, redundancies, and cross-group improvement opportunities. Respond as JSON.`;

    const result = await generateText({
      provider: this.aiConfig.provider,
      model: this.aiConfig.model,
      apiKey: this.aiConfig.apiKey,
      systemPrompt,
      userMessage,
      maxTokens: 2048,
      baseUrl: this.aiConfig.baseUrl,
    });

    const usage = result.usage
      ? { input: result.usage.inputTokens, output: result.usage.outputTokens }
      : { input: 0, output: 0 };

    return parseGroupResponse(result.text, this.context, usage);
  }

  /**
   * Respond to a negotiation proposal from another group.
   */
  async negotiate(proposal: GroupNegotiation): Promise<GroupNegotiation> {
    const systemPrompt = buildGroupSystemPrompt(this.context);
    const userMessage = `Another group ("${proposal.proposingGroupId}") is proposing a change that affects your team:

PROPOSAL TYPE: ${proposal.proposalType}
DESCRIPTION: ${proposal.description}
AFFECTED NODES: ${proposal.affectedNodeIds.join(', ')}
REASON: ${proposal.reason}

Evaluate this proposal from your team's perspective. Respond with JSON:
{
  "accepted": true/false,
  "counterProposal": "optional alternative suggestion",
  "reason": "why you accept or reject"
}`;

    const result = await generateText({
      provider: this.aiConfig.provider,
      model: this.aiConfig.model,
      apiKey: this.aiConfig.apiKey,
      systemPrompt,
      userMessage,
      maxTokens: 512,
      baseUrl: this.aiConfig.baseUrl,
    });

    let cleaned = result.text.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    }

    try {
      const resp = JSON.parse(cleaned);
      return {
        ...proposal,
        response: {
          accepted: !!resp.accepted,
          counterProposal: resp.counterProposal,
          reason: resp.reason ?? 'No reason given.',
        },
      };
    } catch {
      return {
        ...proposal,
        response: {
          accepted: false,
          reason: `Could not parse response: ${result.text}`,
        },
      };
    }
  }
}
