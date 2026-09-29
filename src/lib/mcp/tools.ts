/**
 * mcp/tools.ts — Workable's MCP tools, independent of the transport.
 *
 * Every model call goes through aiClient.generateText, so the caller decides
 * the provider: the MCP server installs a sampling override (Hermes's own
 * model), or passes a direct provider config from env.
 */

import { generateText, type AIProviderConfig } from '@/lib/aiClient';
import { AgentOrchestrator } from '@/lib/agents/orchestrator';
import { orchestratorResultToOptimizeResponse } from '@/lib/agents/adapters';
import { runDistributedUpdate } from '@/lib/agents/distributedUpdate';
import { buildWorkflowFromText, PARSE_WORKFLOW_SYSTEM_PROMPT } from '@/lib/parseWorkflow';
import { applyUpdate, isWorkflowGraph, summarizeGraph, toCanvasImport, toServerState, type WorkflowGraph } from '@/lib/workflowGraph';
import type { GraphStore } from './graphStore';

export interface ToolContext {
  ai: AIProviderConfig;
  store: GraphStore;
  /** Base URL of a running Workable (for push_to_canvas). */
  workableUrl: string;
  /** Parallel node agents during analysis. Keep low when sampling is rate-limited. */
  maxConcurrent?: number;
  fetchImpl?: typeof fetch;
}

export class ToolInputError extends Error {}

/** Directive the Hermes desktop app renders as a live workflow card in chat. */
export function chatCard(graphId: string): string {
  return `::workable-graph{id="${graphId}"}`;
}

const CHAT_CARD_HINT = 'To show this workflow in the Hermes app, put chatCard on a line of its own in your reply.';

/** Resolve a tool's graph input: a stored graphId, or an inline graph (which is then stored). */
export function resolveGraph(ctx: ToolContext, input: { graphId?: string; graph?: unknown }): { id: string; graph: WorkflowGraph } {
  if (input.graphId) {
    const graph = ctx.store.get(input.graphId);
    if (!graph) throw new ToolInputError(`No graph with id "${input.graphId}". Call generate_workflow first, or pass the graph itself.`);
    return { id: input.graphId, graph };
  }
  if (input.graph !== undefined) {
    const g = typeof input.graph === 'string' ? JSON.parse(input.graph) : input.graph;
    if (!isWorkflowGraph(g)) throw new ToolInputError('graph must have customNodes, customEdges and baselinePositions (the shape generate_workflow returns).');
    return { id: ctx.store.put(g), graph: g };
  }
  throw new ToolInputError('Pass graphId (from generate_workflow) or graph.');
}

export async function generateWorkflow(ctx: ToolContext, input: { description: string }) {
  const description = input.description?.trim();
  if (!description) throw new ToolInputError('description is required.');
  const res = await generateText({
    ...ctx.ai, apiKey: ctx.ai.apiKey, systemPrompt: PARSE_WORKFLOW_SYSTEM_PROMPT, userMessage: description, maxTokens: 8000,
  });
  const parsed = buildWorkflowFromText(res.text);
  const graph: WorkflowGraph = {
    customNodes: parsed.customNodes,
    customEdges: parsed.customEdges,
    baselinePositions: parsed.baselinePositions,
    ecosystemPositions: parsed.ecosystemPositions,
    metadataOverrides: parsed.metadataOverrides,
    workflowGroups: parsed.workflowGroups,
    settings: parsed.settings,
  };
  const graphId = ctx.store.put(graph);
  return {
    graphId, nodeCount: parsed.nodeCount, edgeCount: parsed.edgeCount, warnings: parsed.warnings,
    chatCard: chatCard(graphId), chatCardHint: CHAT_CARD_HINT, workflow: summarizeGraph(graph),
  };
}

export async function analyzeBottlenecks(ctx: ToolContext, input: { graphId?: string; graph?: unknown }) {
  const { id, graph } = resolveGraph(ctx, input);
  const orchestrator = new AgentOrchestrator(toServerState(graph), ctx.ai, ctx.maxConcurrent ?? 3);
  let failed = 0;
  const result = await orchestrator.runFullOrchestration((_, status) => { if (status === 'error') failed++; });
  if (failed > 0 && result.responses.length === 0) {
    throw new Error(`All ${failed} node agents failed. Check the model connection (MCP sampling or WORKABLE_AI_* settings).`);
  }
  const optimize = orchestratorResultToOptimizeResponse(result);
  return {
    graphId: id,
    bottlenecks: result.bottlenecks.map(b => ({ nodeId: b.nodeId, node: b.nodeName, reason: b.reason })),
    suggestedConnections: result.proposedEdges.map(e => ({ from: e.source, to: e.target, reason: e.reason })),
    orphanWarnings: result.orphanWarnings.map(o => ({ node: o.nodeName, reason: o.reason })),
    conflicts: result.conflicts,
    agentsRun: result.responses.length,
    agentsFailed: failed,
    analysis: optimize.analysis.slice(0, 6000),
  };
}

export async function patchWorkflow(ctx: ToolContext, input: { graphId?: string; graph?: unknown; change: string }) {
  const change = input.change?.trim();
  if (!change) throw new ToolInputError('change is required: describe the edit in plain English.');
  const { id, graph } = resolveGraph(ctx, input);
  const update = await runDistributedUpdate(change, toServerState(graph), ctx.ai);
  const next = applyUpdate(graph, update);
  const graphId = ctx.store.put(next);
  return {
    graphId,
    previousGraphId: id,
    chatCard: chatCard(graphId),
    chatCardHint: CHAT_CARD_HINT,
    summary: update.summary,
    changes: {
      addedNodes: update.add.nodes.map(n => n.name),
      addedEdges: update.add.edges.length,
      updatedNodes: update.update.nodes.map(n => n.id),
      removedNodes: update.remove.nodeIds,
      removedEdges: update.remove.edgeIds.length,
    },
    workflow: summarizeGraph(next),
  };
}

export async function pushToCanvas(ctx: ToolContext, input: { graphId?: string; graph?: unknown }) {
  const { id, graph } = resolveGraph(ctx, input);
  const doFetch = ctx.fetchImpl ?? fetch;
  const base = ctx.workableUrl.replace(/\/$/, '');
  let res: Response;
  try {
    res = await doFetch(`${base}/api/graph-state`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(toCanvasImport(graph)),
    });
  } catch {
    throw new ToolInputError(`Workable isn't reachable at ${base}. Start it with \`npm run dev\` in the workable repo, then try again.`);
  }
  if (!res.ok) throw new ToolInputError(`Workable rejected the graph (HTTP ${res.status}).`);
  return { graphId: id, url: `${base}/?open=canvas`, message: `The workflow is on the Workable canvas. Open ${base}/?open=canvas to review it.` };
}
