/**
 * workflowGraph.ts — the portable graph format used outside the browser
 * (MCP server, Hermes). Same shape the canvas imports, so a graph can go
 * straight onto the canvas with PUT /api/graph-state { action: 'importAndReset' }.
 */

import type { CustomEdgeConfig, CustomNodeConfig, GlobalSettings, ServerGraphState, WorkflowGroup } from '@/lib/serverState';
import type { DistributedUpdateResult } from '@/lib/agents/distributedUpdate';
import { CORE_NODE_IDS } from '@/lib/constants';
import { groupAwareLayout, hierarchicalLayout } from '@/lib/layout';

export interface WorkflowGraph {
  customNodes: CustomNodeConfig[];
  customEdges: CustomEdgeConfig[];
  baselinePositions: Record<string, { x: number; y: number }>;
  ecosystemPositions?: Record<string, { x: number; y: number }>;
  metadataOverrides?: GlobalSettings['metadataOverrides'];
  workflowGroups?: WorkflowGroup[];
  settings?: { hiddenCoreNodes?: string[] };
}

export function isWorkflowGraph(v: unknown): v is WorkflowGraph {
  const g = v as WorkflowGraph;
  return !!g && Array.isArray(g.customNodes) && Array.isArray(g.customEdges) && typeof g.baselinePositions === 'object';
}

/** A fresh, standalone ServerGraphState for the agent layer — never touches the web app's singleton. */
export function toServerState(graph: WorkflowGraph): ServerGraphState {
  const positions = { ...graph.baselinePositions };
  const eco = { ...(graph.ecosystemPositions ?? {}) };
  return {
    baselinePositions: positions,
    ecosystemPositions: eco,
    originalBaselinePositions: { ...positions },
    originalEcosystemPositions: { ...eco },
    customNodes: graph.customNodes,
    customEdges: graph.customEdges,
    settings: {
      nodePause: 1.0,
      edgeWeightOverrides: {},
      nodeDelayOverrides: {},
      metadataOverrides: graph.metadataOverrides ?? {},
      workflowGroups: graph.workflowGroups ?? [],
      hiddenCoreNodes: graph.settings?.hiddenCoreNodes ?? [...CORE_NODE_IDS],
    },
    lastUpdated: Date.now(),
  };
}

/** Body for PUT /api/graph-state that puts this graph on the canvas. */
export function toCanvasImport(graph: WorkflowGraph) {
  return {
    action: 'importAndReset',
    customNodes: graph.customNodes,
    customEdges: graph.customEdges,
    baselinePositions: graph.baselinePositions,
    ecosystemPositions: graph.ecosystemPositions ?? {},
    settings: {
      metadataOverrides: graph.metadataOverrides ?? {},
      workflowGroups: graph.workflowGroups ?? [],
      hiddenCoreNodes: graph.settings?.hiddenCoreNodes ?? [...CORE_NODE_IDS],
    },
  };
}

/** Compact, model-friendly view: names and relationships, no coordinates. */
export function summarizeGraph(graph: WorkflowGraph) {
  const meta = graph.metadataOverrides ?? {};
  const nameOf = (id: string) => meta[id]?.name ?? graph.customNodes.find(n => n.id === id)?.label ?? id;
  return {
    nodes: graph.customNodes.map(n => ({
      id: n.id,
      name: nameOf(n.id),
      role: meta[n.id]?.role ?? n.role,
      ...(meta[n.id]?.summary ? { summary: meta[n.id]!.summary } : {}),
      ...(meta[n.id]?.tasks?.length ? { tasks: meta[n.id]!.tasks!.map(t => t.title) } : {}),
    })),
    edges: graph.customEdges.map(e => ({ id: e.id, from: nameOf(e.source), to: nameOf(e.target), ...(meta[e.id]?.name ? { name: meta[e.id]!.name } : {}) })),
    groups: (graph.workflowGroups ?? []).map(g => ({ id: g.id, name: g.name, nodes: g.nodeIds.map(nameOf) })),
  };
}

function mapRole(role: string | undefined): CustomNodeConfig['role'] {
  return role === 'person' || role === 'output' || role === 'external' ? role : 'tool';
}

/** Re-run the same layout the generator uses, so patched graphs look like freshly generated ones. */
export function relayout(graph: WorkflowGraph): WorkflowGraph {
  const w = Math.max(900, graph.customNodes.length * 140);
  const h = Math.max(720, Math.min(graph.customNodes.length, 6) * 150);
  let positions = hierarchicalLayout(graph.customNodes, graph.customEdges, w, h);
  const groups = graph.workflowGroups ?? [];
  if (groups.length) {
    positions = groupAwareLayout(positions, groups.map(g => ({ id: g.id, nodeIds: g.nodeIds, ...(g.parentGroupId ? { parentGroupId: g.parentGroupId } : {}) })), w, graph.customEdges);
  }
  return {
    ...graph,
    customNodes: graph.customNodes.map(n => ({ ...n, position: positions[n.id] ?? n.position })),
    baselinePositions: positions,
  };
}

/** Apply a runDistributedUpdate() result to a graph and return the new graph (input is not mutated). */
export function applyUpdate(graph: WorkflowGraph, update: DistributedUpdateResult): WorkflowGraph {
  const meta: GlobalSettings['metadataOverrides'] = JSON.parse(JSON.stringify(graph.metadataOverrides ?? {}));
  let nodes = graph.customNodes.map(n => ({ ...n }));
  let edges = graph.customEdges.map(e => ({ ...e }));
  let groups: WorkflowGroup[] = (graph.workflowGroups ?? []).map(g => ({ ...g, nodeIds: [...g.nodeIds] }));

  // Removals first, so an id can be removed and re-added in one patch.
  const removeNodes = new Set(update.remove.nodeIds);
  const removeEdges = new Set(update.remove.edgeIds);
  const removeGroups = new Set(update.remove.groupIds);
  nodes = nodes.filter(n => !removeNodes.has(n.id));
  edges = edges.filter(e => !removeEdges.has(e.id) && !removeNodes.has(e.source) && !removeNodes.has(e.target));
  groups = groups.filter(g => !removeGroups.has(g.id)).map(g => ({ ...g, nodeIds: g.nodeIds.filter(id => !removeNodes.has(id)) }));
  for (const id of [...removeNodes, ...removeEdges]) delete meta[id];

  for (const n of update.add.nodes) {
    if (nodes.some(x => x.id === n.id)) continue;
    nodes.push({
      id: n.id, labelInitials: n.initials || n.name.slice(0, 2).toUpperCase(), label: n.name,
      nodeType: 'neural', role: mapRole(n.role), source: 'ai-generated', position: { x: 0, y: 0 },
    });
    meta[n.id] = {
      name: n.name, role: mapRole(n.role),
      ...(n.summary ? { summary: n.summary } : {}),
      ...(n.constraints ? { constraints: n.constraints } : {}),
      ...(n.tasks?.length ? { tasks: n.tasks } : {}),
    };
  }
  const nodeIds = new Set(nodes.map(n => n.id));
  for (const e of update.add.edges) {
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target) || edges.some(x => x.id === e.id)) continue;
    edges.push({ id: e.id || `e_${e.source}_${e.target}`, source: e.source, target: e.target, sequence: 1, weight: 1, isCustom: true, ...(e.name ? { name: e.name } : {}) });
    if (e.name) meta[e.id] = { name: e.name, summary: e.name };
  }
  for (const g of update.add.groups) {
    if (groups.some(x => x.id === g.id)) continue;
    groups.push({ id: g.id, name: g.name, color: g.color, nodeIds: g.nodeIds.filter(id => nodeIds.has(id)), ...(g.parentGroupId ? { parentGroupId: g.parentGroupId } : {}) });
  }

  for (const u of update.update.nodes) {
    if (!nodeIds.has(u.id)) continue;
    meta[u.id] = {
      ...meta[u.id],
      ...(u.name ? { name: u.name } : {}),
      ...(u.role ? { role: mapRole(u.role) } : {}),
      ...(u.summary ? { summary: u.summary } : {}),
      ...(u.constraints ? { constraints: u.constraints } : {}),
    };
    if (u.name) nodes = nodes.map(n => (n.id === u.id ? { ...n, label: u.name! } : n));
    if (u.role) nodes = nodes.map(n => (n.id === u.id ? { ...n, role: mapRole(u.role) } : n));
  }
  for (const t of update.update.nodeTasks) {
    if (nodeIds.has(t.nodeId)) meta[t.nodeId] = { ...meta[t.nodeId], tasks: t.tasks };
  }
  for (const e of update.update.edges) {
    if (!edges.some(x => x.id === e.id)) continue;
    meta[e.id] = { ...meta[e.id], ...(e.name ? { name: e.name } : {}), ...(e.summary ? { summary: e.summary } : {}) };
  }
  for (const g of update.update.groups) {
    groups = groups.map(x => (x.id === g.groupId ? { ...x, ...(g.name ? { name: g.name } : {}), ...(g.color ? { color: g.color } : {}) } : x));
  }
  for (const ext of update.update.groupExtensions) {
    groups = groups.map(x => {
      if (x.id !== ext.groupId) return x;
      const ids = new Set(x.nodeIds);
      ext.addNodeIds.filter(id => nodeIds.has(id)).forEach(id => ids.add(id));
      ext.removeNodeIds.forEach(id => ids.delete(id));
      return { ...x, nodeIds: [...ids] };
    });
  }

  return relayout({ ...graph, customNodes: nodes, customEdges: edges, workflowGroups: groups, metadataOverrides: meta });
}
