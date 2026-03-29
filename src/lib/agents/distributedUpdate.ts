/**
 * agents/distributedUpdate.ts — Distributed implementation of /api/ai/update.
 *
 * Pattern: Coordinator + Affected-Node agents
 *   1. Coordinator agent interprets the user prompt and identifies affected nodes
 *   2. Each affected node gets a focused agent call with node-specific instructions
 *   3. Results merge into an AIUpdateResult patch (same shape as monolithic route)
 *
 * Token budget:
 *   - Coordinator: ~800–1,200 input (lightweight node list + user prompt)
 *   - Per affected node: ~1,000–1,500 input (ego-centric context + specific instruction)
 *   - Typical 3-node change: ~4,500–6,000 total (vs. monolithic ~10,500–14,000)
 */

import type { ServerGraphState } from '../serverState';
import { generateText, type AIProviderConfig } from '../aiClient';
import { NODE_DATA, EDGE_DATA } from '../constants';
import { buildAgentContext } from './contextBuilder';
import { buildCoordinatorNodeList } from './adapters';
import { jsonrepair } from 'jsonrepair';

// ── Types (matching the monolithic AIUpdateResult) ───────────────────────────

interface AITaskItem {
  id: string;
  title: string;
  status: 'todo' | 'in-progress' | 'done' | 'blocked' | 'review';
  priority: 'low' | 'medium' | 'high';
  note?: string;
}

export interface DistributedUpdateResult {
  summary: string;
  add: {
    nodes: Array<{
      id: string; name: string; initials: string; role: string;
      summary?: string; constraints?: string; tasks?: AITaskItem[];
    }>;
    edges: Array<{ id: string; source: string; target: string; name?: string }>;
    groups: Array<{ id: string; name: string; color: string; nodeIds: string[]; parentGroupId?: string | null }>;
  };
  update: {
    nodes: Array<{ id: string; name?: string; role?: string; summary?: string; constraints?: string }>;
    groupExtensions: Array<{ groupId: string; addNodeIds: string[]; removeNodeIds: string[] }>;
    groups: Array<{ groupId: string; name?: string; color?: string }>;
    nodeTasks: Array<{ nodeId: string; tasks: AITaskItem[] }>;
    edges: Array<{ id: string; name?: string; summary?: string }>;
  };
  remove: {
    nodeIds: string[];
    edgeIds: string[];
    groupIds: string[];
  };
}

// ── Coordinator Agent ────────────────────────────────────────────────────────

const COORDINATOR_SYSTEM_PROMPT = `You are a workflow change coordinator. You receive a list of nodes and edges, plus a user's update instruction.

Your job is to identify WHICH nodes are affected by the user's instruction and WHAT each affected node should change.

Respond ONLY with valid JSON:
{
  "summary": "1-2 sentences describing the overall change",
  "changeType": "add_node" | "remove_node" | "modify_metadata" | "restructure" | "add_edge" | "remove_edge",
  "affectedNodeIds": ["id1", "id2"],
  "newNodes": [
    { "id": "upd_<name>", "name": "Display Name", "initials": "DN", "role": "person|tool|external|output", "summary": "What this node does", "connectFrom": ["id1"], "connectTo": ["id2"] }
  ],
  "newEdges": [
    { "source": "id1", "target": "id2", "name": "Connection label" }
  ],
  "removeNodeIds": ["id_to_remove"],
  "removeEdgeIds": ["edge_to_remove"],
  "perNodeInstructions": {
    "id1": "Specific instruction for what should change about this node",
    "id2": "Specific instruction for this node"
  }
}

Rules:
- newNodes: use "upd_" prefix for IDs. Only include if the user explicitly asks to add entities.
- newEdges: only reference nodes that exist in the list OR are in newNodes.
- removeNodeIds/removeEdgeIds: only reference IDs from the provided list.
- perNodeInstructions: only for EXISTING nodes that need metadata updates.
- Use empty arrays/objects for sections that don't apply.
- Output ONLY the JSON — no explanation text.`;

interface CoordinatorResult {
  summary: string;
  changeType: string;
  affectedNodeIds: string[];
  newNodes: Array<{
    id: string; name: string; initials: string; role: string;
    summary?: string; connectFrom?: string[]; connectTo?: string[];
  }>;
  newEdges: Array<{ source: string; target: string; name?: string }>;
  removeNodeIds: string[];
  removeEdgeIds: string[];
  perNodeInstructions: Record<string, string>;
}

// ── Per-Node Update Agent ────────────────────────────────────────────────────

const NODE_UPDATE_SYSTEM_PROMPT = `You are a workflow node update agent. You receive your ego-centric context and a specific change instruction.

Respond ONLY with valid JSON describing what should change about you:
{
  "metadataUpdates": {
    "name": "optional new name",
    "role": "optional new role",
    "summary": "optional new summary",
    "constraints": "optional new constraints"
  },
  "taskUpdates": {
    "replaceTasks": [
      { "id": "t_<6chars>", "title": "Task title", "status": "todo", "priority": "medium" }
    ]
  },
  "edgeUpdates": {
    "renameEdges": [
      { "edgeId": "existing_edge_id", "name": "new name" }
    ]
  }
}

Rules:
- Only include fields that are ACTUALLY changing — omit unchanged fields
- For metadataUpdates: leave out any field not mentioned in the instruction
- For taskUpdates.replaceTasks: provide the COMPLETE new task list if tasks change, or omit taskUpdates entirely
- For edgeUpdates.renameEdges: only rename edges if the instruction mentions it
- Output ONLY the JSON — no explanation text.`;

interface NodeUpdateResult {
  metadataUpdates?: {
    name?: string; role?: string; summary?: string; constraints?: string;
  };
  taskUpdates?: {
    replaceTasks?: AITaskItem[];
  };
  edgeUpdates?: {
    renameEdges?: Array<{ edgeId: string; name: string }>;
  };
}

// ── Main Pipeline ────────────────────────────────────────────────────────────

export async function runDistributedUpdate(
  prompt: string,
  state: ServerGraphState,
  aiConfig: AIProviderConfig,
): Promise<DistributedUpdateResult> {
  // Build lightweight node list for coordinator
  const overrides = state.settings?.metadataOverrides ?? {};
  const hiddenCore = new Set(state.settings?.hiddenCoreNodes ?? []);

  const allNodes: Array<{ id: string; name: string; role: string }> = [];

  for (const [id, n] of Object.entries(NODE_DATA)) {
    if (hiddenCore.has(id)) continue;
    allNodes.push({
      id,
      name: overrides[id]?.name ?? n.name,
      role: overrides[id]?.role ?? n.role,
    });
  }
  for (const n of state.customNodes) {
    allNodes.push({
      id: n.id,
      name: overrides[n.id]?.name ?? n.label,
      role: overrides[n.id]?.role ?? n.role,
    });
  }

  const allEdges: Array<{ id: string; source: string; target: string; name?: string }> = [];
  for (const [edgeId, e] of Object.entries(EDGE_DATA)) {
    const hyphen = edgeId.indexOf('-');
    if (hyphen === -1) continue;
    allEdges.push({
      id: edgeId,
      source: edgeId.slice(0, hyphen),
      target: edgeId.slice(hyphen + 1),
      name: overrides[edgeId]?.name ?? e.name,
    });
  }
  for (const e of state.customEdges) {
    allEdges.push({ id: e.id, source: e.source, target: e.target, name: e.name });
  }

  const nodeList = buildCoordinatorNodeList(allNodes, allEdges);

  // Step 1: Coordinator agent
  const coordResult = await generateText({
    provider: aiConfig.provider,
    model: aiConfig.model,
    apiKey: aiConfig.apiKey,
    systemPrompt: COORDINATOR_SYSTEM_PROMPT,
    userMessage: `WORKFLOW:\n${nodeList}\n\nUPDATE INSTRUCTION:\n${prompt}`,
    maxTokens: 2048,
    baseUrl: aiConfig.baseUrl,
  });

  let coordinator: CoordinatorResult;
  try {
    const cleaned = coordResult.text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    coordinator = JSON.parse(jsonrepair(cleaned));
  } catch {
    // Fallback: return empty patch
    return emptyResult(`Could not parse coordinator response: ${coordResult.text.slice(0, 200)}`);
  }

  // Step 2: Per-node update agents (parallel)
  const nodeUpdates = new Map<string, NodeUpdateResult>();

  const nodePromises = Object.entries(coordinator.perNodeInstructions).map(
    async ([nodeId, instruction]) => {
      try {
        const ctx = buildAgentContext(nodeId, state);
        const ctxSummary = `You are "${ctx.nodeName}" (${ctx.role}). Summary: ${ctx.summary || 'none'}. Constraints: ${ctx.constraints || 'none'}.
Inbound: ${ctx.inboundEdges.map(e => `${e.fromName} via "${e.edgeName}"`).join(', ') || 'none'}
Outbound: ${ctx.outboundEdges.map(e => `${e.toName} via "${e.edgeName}"`).join(', ') || 'none'}`;

        const result = await generateText({
          provider: aiConfig.provider,
          model: aiConfig.model,
          apiKey: aiConfig.apiKey,
          systemPrompt: NODE_UPDATE_SYSTEM_PROMPT,
          userMessage: `YOUR CONTEXT:\n${ctxSummary}\n\nCHANGE INSTRUCTION:\n${instruction}\n\nWhat should change about you? Respond as JSON.`,
          maxTokens: 512,
          baseUrl: aiConfig.baseUrl,
        });

        const cleaned = result.text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
        const parsed: NodeUpdateResult = JSON.parse(jsonrepair(cleaned));
        nodeUpdates.set(nodeId, parsed);
      } catch {
        // Non-fatal: skip this node
      }
    },
  );

  await Promise.allSettled(nodePromises);

  // Step 3: Merge into AIUpdateResult shape
  return mergeResults(coordinator, nodeUpdates, allNodes);
}

// ── Merge Logic ──────────────────────────────────────────────────────────────

function mergeResults(
  coordinator: CoordinatorResult,
  nodeUpdates: Map<string, NodeUpdateResult>,
  allNodes: Array<{ id: string; name: string; role: string }>,
): DistributedUpdateResult {
  // Add nodes
  const addNodes = (coordinator.newNodes ?? []).map(n => ({
    id: n.id.startsWith('upd_') ? n.id : `upd_${n.id}`,
    name: n.name,
    initials: n.initials || n.name.slice(0, 2).toUpperCase(),
    role: n.role,
    summary: n.summary,
  }));

  // Add edges
  const addEdges = (coordinator.newEdges ?? []).map((e, i) => ({
    id: `upd_e_${e.source}_${e.target}`,
    source: e.source,
    target: e.target,
    name: e.name,
  }));

  // Also add edges from newNodes' connectFrom/connectTo
  for (const nn of coordinator.newNodes ?? []) {
    const nodeId = nn.id.startsWith('upd_') ? nn.id : `upd_${nn.id}`;
    for (const srcId of nn.connectFrom ?? []) {
      const edgeId = `upd_e_${srcId}_${nodeId}`;
      if (!addEdges.find(e => e.id === edgeId)) {
        addEdges.push({ id: edgeId, source: srcId, target: nodeId, name: undefined });
      }
    }
    for (const tgtId of nn.connectTo ?? []) {
      const edgeId = `upd_e_${nodeId}_${tgtId}`;
      if (!addEdges.find(e => e.id === edgeId)) {
        addEdges.push({ id: edgeId, source: nodeId, target: tgtId, name: undefined });
      }
    }
  }

  // Update nodes (from per-node agent results)
  const updateNodes: DistributedUpdateResult['update']['nodes'] = [];
  const updateNodeTasks: DistributedUpdateResult['update']['nodeTasks'] = [];
  const updateEdges: DistributedUpdateResult['update']['edges'] = [];

  for (const [nodeId, upd] of nodeUpdates) {
    if (upd.metadataUpdates) {
      const meta = upd.metadataUpdates;
      if (meta.name || meta.role || meta.summary || meta.constraints) {
        updateNodes.push({
          id: nodeId,
          ...(meta.name ? { name: meta.name } : {}),
          ...(meta.role ? { role: meta.role } : {}),
          ...(meta.summary ? { summary: meta.summary } : {}),
          ...(meta.constraints ? { constraints: meta.constraints } : {}),
        });
      }
    }

    if (upd.taskUpdates?.replaceTasks) {
      updateNodeTasks.push({
        nodeId,
        tasks: upd.taskUpdates.replaceTasks,
      });
    }

    if (upd.edgeUpdates?.renameEdges) {
      for (const re of upd.edgeUpdates.renameEdges) {
        updateEdges.push({ id: re.edgeId, name: re.name });
      }
    }
  }

  // Remove nodes
  const removeNodeIds = coordinator.removeNodeIds ?? [];

  // Remove edges — include edges of removed nodes
  const removeEdgeIds = [...(coordinator.removeEdgeIds ?? [])];

  return {
    summary: coordinator.summary || 'Workflow updated via distributed agents.',
    add: {
      nodes: addNodes,
      edges: addEdges,
      groups: [],
    },
    update: {
      nodes: updateNodes,
      groupExtensions: [],
      groups: [],
      nodeTasks: updateNodeTasks,
      edges: updateEdges,
    },
    remove: {
      nodeIds: removeNodeIds,
      edgeIds: removeEdgeIds,
      groupIds: [],
    },
  };
}

function emptyResult(summary: string): DistributedUpdateResult {
  return {
    summary,
    add: { nodes: [], edges: [], groups: [] },
    update: { nodes: [], groupExtensions: [], groups: [], nodeTasks: [], edges: [] },
    remove: { nodeIds: [], edgeIds: [], groupIds: [] },
  };
}
