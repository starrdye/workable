/**
 * agents/contextBuilder.ts — Build ego-centric agent context from server state.
 * Phase 2: Node-as-an-Agent architecture.
 *
 * The key insight: instead of serialising the entire graph (~50K+ tokens for
 * large workflows), each agent receives only its local neighbourhood (~500–1500
 * tokens). This is what makes distributed analysis feasible at any scale.
 */

import { NODE_DATA, EDGE_DATA } from '../constants';
import type { ServerGraphState, WorkflowGroup } from '../serverState';
import type { AgentContext, GroupContext } from './types';

// ── Node Context Builder ─────────────────────────────────────────────────────

/**
 * Build ego-centric context for a single node — its identity, direct neighbours,
 * group memberships, and 1-hop neighbour summaries.
 */
export function buildAgentContext(
  nodeId: string,
  state: ServerGraphState,
): AgentContext {
  const overrides = state.settings?.metadataOverrides ?? {};
  const groups = state.settings?.workflowGroups ?? [];

  // Resolve node identity
  const coreNode = NODE_DATA[nodeId];
  const customNode = state.customNodes.find(n => n.id === nodeId);
  const meta = overrides[nodeId];

  const nodeName = meta?.name ?? coreNode?.name ?? customNode?.label ?? nodeId;
  const role = meta?.role ?? coreNode?.role ?? customNode?.role ?? 'unknown';
  const summary = meta?.summary ?? coreNode?.summary ?? '';
  const constraints = meta?.constraints;
  const tasks = meta?.tasks ?? [];

  // Collect edges (core + custom)
  const inboundEdges: AgentContext['inboundEdges'] = [];
  const outboundEdges: AgentContext['outboundEdges'] = [];
  const neighborIds = new Set<string>();

  // Core edges
  for (const [edgeId, edgeData] of Object.entries(EDGE_DATA)) {
    const hyphen = edgeId.indexOf('-');
    if (hyphen === -1) continue;
    const src = edgeId.slice(0, hyphen);
    const tgt = edgeId.slice(hyphen + 1);
    const weight = state.settings?.edgeWeightOverrides?.[edgeId]?.weight ?? edgeData.sequence ?? 1;

    if (tgt === nodeId) {
      inboundEdges.push({ fromId: src, fromName: resolveName(src, state), edgeName: edgeData.name, weight });
      neighborIds.add(src);
    }
    if (src === nodeId) {
      outboundEdges.push({ toId: tgt, toName: resolveName(tgt, state), edgeName: edgeData.name, weight });
      neighborIds.add(tgt);
    }
  }

  // Custom edges
  for (const edge of state.customEdges) {
    if (edge.isImprovementOnly) continue;
    const weight = edge.weight ?? 1;
    if (edge.target === nodeId) {
      inboundEdges.push({ fromId: edge.source, fromName: resolveName(edge.source, state), edgeName: edge.name ?? '', weight });
      neighborIds.add(edge.source);
    }
    if (edge.source === nodeId) {
      outboundEdges.push({ toId: edge.target, toName: resolveName(edge.target, state), edgeName: edge.name ?? '', weight });
      neighborIds.add(edge.target);
    }
  }

  // Group memberships
  const groupMemberships = groups
    .filter(g => g.nodeIds.includes(nodeId))
    .map(g => ({
      groupId: g.id,
      groupName: g.name,
      peerNodeIds: g.nodeIds.filter(id => id !== nodeId),
    }));

  // 1-hop neighbour summaries
  const neighborSummaries = Array.from(neighborIds).map(nid => ({
    id: nid,
    name: resolveName(nid, state),
    role: resolveRole(nid, state),
    summary: resolveSummary(nid, state),
  }));

  return {
    nodeId, nodeName, role, summary, constraints, tasks,
    inboundEdges, outboundEdges, groupMemberships, neighborSummaries,
  };
}

// ── Group Context Builder (Phase 4) ──────────────────────────────────────────

/**
 * Build group-level context — all member nodes' ego-centric contexts plus
 * boundary edges connecting to external nodes.
 */
export function buildGroupContext(
  groupId: string,
  state: ServerGraphState,
): GroupContext {
  const groups = state.settings?.workflowGroups ?? [];
  const group = groups.find(g => g.id === groupId);
  if (!group) {
    return {
      groupId, groupName: groupId, color: '#6366F1',
      memberNodes: [], boundaryEdges: [], subgroups: [],
      adjacentGroupSummaries: [],
    };
  }

  const memberSet = new Set(group.nodeIds);

  // Build context for each member
  const memberNodes = group.nodeIds.map(nid => buildAgentContext(nid, state));

  // Find boundary edges: edges where exactly one endpoint is inside the group
  const boundaryEdges: GroupContext['boundaryEdges'] = [];

  // Core edges
  for (const [edgeId, edgeData] of Object.entries(EDGE_DATA)) {
    const hyphen = edgeId.indexOf('-');
    if (hyphen === -1) continue;
    const src = edgeId.slice(0, hyphen);
    const tgt = edgeId.slice(hyphen + 1);
    if (memberSet.has(src) && !memberSet.has(tgt)) {
      boundaryEdges.push({
        edgeId, internalNodeId: src, externalNodeId: tgt,
        externalNodeName: resolveName(tgt, state),
        externalNodeRole: resolveRole(tgt, state),
        direction: 'outbound',
      });
    }
    if (!memberSet.has(src) && memberSet.has(tgt)) {
      boundaryEdges.push({
        edgeId, internalNodeId: tgt, externalNodeId: src,
        externalNodeName: resolveName(src, state),
        externalNodeRole: resolveRole(src, state),
        direction: 'inbound',
      });
    }
  }

  // Custom edges
  for (const edge of state.customEdges) {
    if (edge.isImprovementOnly) continue;
    if (memberSet.has(edge.source) && !memberSet.has(edge.target)) {
      boundaryEdges.push({
        edgeId: edge.id, internalNodeId: edge.source, externalNodeId: edge.target,
        externalNodeName: resolveName(edge.target, state),
        externalNodeRole: resolveRole(edge.target, state),
        direction: 'outbound',
      });
    }
    if (!memberSet.has(edge.source) && memberSet.has(edge.target)) {
      boundaryEdges.push({
        edgeId: edge.id, internalNodeId: edge.target, externalNodeId: edge.source,
        externalNodeName: resolveName(edge.source, state),
        externalNodeRole: resolveRole(edge.source, state),
        direction: 'inbound',
      });
    }
  }

  // Subgroups
  const subgroups = groups
    .filter(g => g.parentGroupId === groupId)
    .map(g => ({ id: g.id, name: g.name, nodeCount: g.nodeIds.length }));

  // Parent group
  const parentGroup = group.parentGroupId
    ? (() => { const p = groups.find(g => g.id === group.parentGroupId); return p ? { id: p.id, name: p.name } : undefined; })()
    : undefined;

  // Adjacent group summaries — groups connected via boundary edges
  const adjacentGroupIds = new Set<string>();
  for (const be of boundaryEdges) {
    for (const g of groups) {
      if (g.id !== groupId && g.nodeIds.includes(be.externalNodeId)) {
        adjacentGroupIds.add(g.id);
      }
    }
  }

  const adjacentGroupSummaries = Array.from(adjacentGroupIds).map(gid => {
    const g = groups.find(gr => gr.id === gid)!;
    const roles = g.nodeIds.map(nid => resolveRole(nid, state));
    const roleCounts: Record<string, number> = {};
    for (const r of roles) {
      roleCounts[r] = (roleCounts[r] ?? 0) + 1;
    }
    const roleSummary = Object.entries(roleCounts).map(([r, c]) => `${c} ${r}`).join(', ');

    // Count edges within this adjacent group
    const adjSet = new Set(g.nodeIds);
    let internalEdgeCount = 0;
    for (const edge of state.customEdges) {
      if (adjSet.has(edge.source) && adjSet.has(edge.target)) internalEdgeCount++;
    }

    return { groupId: gid, groupName: g.name, nodeCount: g.nodeIds.length, edgeCount: internalEdgeCount, roleSummary };
  });

  return {
    groupId, groupName: group.name, color: group.color,
    memberNodes, boundaryEdges, subgroups, parentGroup,
    adjacentGroupSummaries,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function resolveName(nodeId: string, state: ServerGraphState): string {
  const meta = state.settings?.metadataOverrides?.[nodeId];
  const core = NODE_DATA[nodeId];
  const custom = state.customNodes.find(n => n.id === nodeId);
  return meta?.name ?? core?.name ?? custom?.label ?? nodeId;
}

function resolveRole(nodeId: string, state: ServerGraphState): string {
  const meta = state.settings?.metadataOverrides?.[nodeId];
  const core = NODE_DATA[nodeId];
  const custom = state.customNodes.find(n => n.id === nodeId);
  return meta?.role ?? core?.role ?? custom?.role ?? 'unknown';
}

function resolveSummary(nodeId: string, state: ServerGraphState): string {
  const meta = state.settings?.metadataOverrides?.[nodeId];
  const core = NODE_DATA[nodeId];
  return meta?.summary ?? core?.summary ?? '';
}
