/**
 * snapshotBuilder.ts — Track 14b-i: Hierarchical Group Summaries
 *
 * Shared snapshot builders for /api/ai/optimize and /api/ai/update.
 * Key improvements over the previous inline builders:
 *   - Per-node group references use stable group IDs (not mutable display names)
 *   - Group block enriched with nodeCount, roleSummary, constraintCount
 * These changes reduce redundant token usage and eliminate rename-fragility.
 */

import { NODE_DATA, EDGE_DATA } from '@/lib/constants';
import type { ServerGraphState } from '@/lib/serverState';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SnapshotNodeEntry {
  id: string;
  name: string;
  role: string;
  summary: string;
  constraints?: string;
  connections?: string[];
  /** Stable group IDs — not names — so the AI references groups by ID. */
  groupIds?: string[];
}

export interface SnapshotEdgeEntry {
  id: string;
  name: string;
  sourceName: string;
  targetName: string;
  summary?: string;
}

export interface SnapshotCustomEdgeEntry {
  id: string;
  name: string;
  sourceName: string;
  targetName: string;
}

/** Enriched group block returned in both optimize and update snapshots. */
export interface SnapshotGroupEntry {
  id: string;
  name: string;
  color: string;
  nodeIds: string[];
  /** Human-readable member names (for AI display). */
  members: string[];
  /** Number of member nodes (pre-computed to save AI reasoning tokens). */
  nodeCount: number;
  /** Role distribution string, e.g. "2 person, 1 tool". */
  roleSummary: string;
  /** Count of member nodes that have a non-empty constraints string. */
  constraintCount: number;
}

export interface OptimizeSnapshot {
  coreNodes: SnapshotNodeEntry[];
  customNodes: SnapshotNodeEntry[];
  coreEdges: SnapshotEdgeEntry[];
  customEdges: SnapshotCustomEdgeEntry[];
  groupSummary: SnapshotGroupEntry[];
  nameLookup: Record<string, string>;
  workflowSnapshot: string;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Build a "2 person, 1 tool" style role summary from an array of role strings.
 * Normalises to lowercase and counts occurrences.
 */
export function buildRoleSummary(roles: string[]): string {
  if (roles.length === 0) return 'empty';
  const counts: Record<string, number> = {};
  for (const r of roles) {
    const normalized = r.toLowerCase();
    counts[normalized] = (counts[normalized] ?? 0) + 1;
  }
  return Object.entries(counts)
    .map(([role, count]) => `${count} ${role}`)
    .join(', ');
}

/**
 * Build a per-node → group ID[] lookup.
 * Uses IDs (not names) so the mapping survives group renames.
 */
export function buildGroupIdLookup(
  groups: Array<{ id: string; nodeIds: string[] }>
): Record<string, string[]> {
  const lookup: Record<string, string[]> = {};
  for (const g of groups) {
    for (const nid of g.nodeIds) {
      if (!lookup[nid]) lookup[nid] = [];
      lookup[nid].push(g.id);
    }
  }
  return lookup;
}

// ─── Optimize snapshot ────────────────────────────────────────────────────────

/**
 * Build the full structured snapshot for /api/ai/optimize.
 * Replaces the inline snapshot-building block in that route.
 */
export function buildOptimizeSnapshot(
  workflowData: Record<string, unknown>
): OptimizeSnapshot {
  const settings = (workflowData.settings ?? {}) as {
    metadataOverrides?: Record<string, {
      name?: string; role?: string; summary?: string;
      constraints?: string; connections?: string[];
    }>;
    hiddenCoreNodes?: string[];
    workflowGroups?: Array<{ id: string; name: string; color?: string; nodeIds: string[] }>;
  };

  const metadataOverrides = settings.metadataOverrides ?? {};
  const hiddenCoreSet     = new Set<string>(settings.hiddenCoreNodes ?? []);
  const groups            = settings.workflowGroups ?? [];

  // Per-node → group IDs (not names)
  const nodeGroupIds = buildGroupIdLookup(groups);

  // Shared name lookup (populated while building coreNodes + customNodes)
  const nameLookup: Record<string, string> = {};

  // ── Core nodes ──────────────────────────────────────────────────────────────
  const coreNodes: SnapshotNodeEntry[] = Object.entries(NODE_DATA)
    .filter(([id]) => !hiddenCoreSet.has(id))
    .map(([id, n]) => {
      const meta = metadataOverrides[id] ?? {};
      const name = meta.name ?? n.name;
      nameLookup[id] = name;
      return {
        id,
        name,
        role:    meta.role    ?? n.role,
        summary: meta.summary ?? n.summary,
        ...(meta.constraints          ? { constraints: meta.constraints }  : {}),
        ...(meta.connections?.length  ? { connections: meta.connections }  : { connections: n.connections }),
        ...(nodeGroupIds[id]?.length  ? { groupIds: nodeGroupIds[id] }     : {}),
      };
    });

  // ── Custom nodes ─────────────────────────────────────────────────────────────
  const customNodes: SnapshotNodeEntry[] = (
    (workflowData.customNodes ?? []) as Array<{ id: string; label: string; role: string }>
  ).map(n => {
    const meta = metadataOverrides[n.id] ?? {};
    const name = meta.name ?? n.label;
    nameLookup[n.id] = name;
    return {
      id:      n.id,
      name,
      role:    meta.role    ?? n.role,
      summary: meta.summary ?? '',
      ...(meta.constraints           ? { constraints: meta.constraints }  : {}),
      ...(meta.connections?.length   ? { connections: meta.connections }  : {}),
      ...(nodeGroupIds[n.id]?.length ? { groupIds: nodeGroupIds[n.id] }   : {}),
    };
  });

  // ── Core edges ───────────────────────────────────────────────────────────────
  const coreEdges: SnapshotEdgeEntry[] = Object.entries(EDGE_DATA)
    .filter(([id]) => {
      const hyphen = id.indexOf('-');
      if (hyphen === -1) return true;
      const src = id.slice(0, hyphen);
      const tgt = id.slice(hyphen + 1);
      return !(hiddenCoreSet.has(src) && hiddenCoreSet.has(tgt));
    })
    .map(([id, e]) => {
      const meta   = metadataOverrides[id] ?? {};
      const hyphen = id.indexOf('-');
      const src    = hyphen !== -1 ? id.slice(0, hyphen) : id;
      const tgt    = hyphen !== -1 ? id.slice(hyphen + 1) : '';
      return {
        id,
        name:       meta.name ?? e.name,
        sourceName: nameLookup[src] ?? src,
        targetName: nameLookup[tgt] ?? tgt,
        summary:    e.summary,
      };
    });

  // ── Custom edges (skip improvement-only) ────────────────────────────────────
  const customEdges: SnapshotCustomEdgeEntry[] = (
    (workflowData.customEdges ?? []) as Array<{
      id: string; source: string; target: string;
      isImprovementOnly?: boolean; name?: string;
    }>
  )
    .filter(e => !e.isImprovementOnly)
    .map(e => {
      const meta = metadataOverrides[e.id] ?? {};
      return {
        id:         e.id,
        name:       meta.name ?? e.name ?? '',
        sourceName: nameLookup[e.source] ?? e.source,
        targetName: nameLookup[e.target] ?? e.target,
      };
    });

  // ── Enriched group summary ───────────────────────────────────────────────────
  const allNodes = [...coreNodes, ...customNodes];
  const groupSummary: SnapshotGroupEntry[] = groups.map(g => {
    const memberNodes    = allNodes.filter(n => g.nodeIds.includes(n.id));
    const roles          = memberNodes.map(n => n.role);
    const constraintCount = memberNodes.filter(n => n.constraints).length;
    return {
      id:              g.id,
      name:            g.name,
      color:           g.color ?? '#6366F1',
      nodeIds:         g.nodeIds,
      members:         g.nodeIds.map(id => nameLookup[id] ?? id),
      nodeCount:       g.nodeIds.length,
      roleSummary:     buildRoleSummary(roles),
      constraintCount,
    };
  });

  const workflowSnapshot = JSON.stringify(
    { coreNodes, coreEdges, customNodes, customEdges, groups: groupSummary },
    null, 2
  );

  return { coreNodes, customNodes, coreEdges, customEdges, groupSummary, nameLookup, workflowSnapshot };
}

// ─── Update snapshot ──────────────────────────────────────────────────────────

/**
 * Build the text-format workflow snapshot for /api/ai/update.
 * Replaces the inline `buildSnapshot` function in that route.
 *
 * Changes vs. original:
 *   - Per-node "Groups:" line now lists group IDs (not names)
 *   - GROUPS section adds a summary line: "Nodes: N | Roles: ... | Constraints: N"
 */
export function buildUpdateSnapshot(state: ServerGraphState): string {
  const lines: string[] = ['CURRENT WORKFLOW SNAPSHOT', '=========================', ''];

  const overrides  = state.settings?.metadataOverrides ?? {};
  const hiddenCore = new Set(state.settings?.hiddenCoreNodes ?? []);
  const groups     = state.settings?.workflowGroups ?? [];

  // Per-node → group IDs (not names)
  const nodeGroupIds = buildGroupIdLookup(groups);

  // Name lookup for edge labels
  const nameLookup: Record<string, string> = {};
  Object.entries(NODE_DATA).forEach(([id, n]) => {
    nameLookup[id] = overrides[id]?.name ?? n.name;
  });
  state.customNodes.forEach(n => {
    nameLookup[n.id] = overrides[n.id]?.name ?? n.label;
  });

  // ── NODES ────────────────────────────────────────────────────────────────────
  const coreNodes   = Object.entries(NODE_DATA).filter(([id]) => !hiddenCore.has(id));
  const customNodes = state.customNodes;
  lines.push(`NODES (${coreNodes.length + customNodes.length})`);

  const formatTasks = (tasks?: { id: string; title: string; status: string; priority: string; note?: string }[]) => {
    if (!tasks?.length) return;
    lines.push(`         Tasks (${tasks.length}):`);
    tasks.forEach(t => {
      const note = t.note ? `  — ${t.note}` : '';
      lines.push(`           [${t.id}] ${t.title}  status:${t.status}  priority:${t.priority}${note}`);
    });
  };

  coreNodes.forEach(([id, n]) => {
    const meta        = overrides[id];
    const name        = meta?.name        ?? n.name;
    const role        = meta?.role        ?? n.role;
    const summary     = meta?.summary     ?? n.summary;
    const conns       = meta?.connections ?? n.connections;
    const constraints = meta?.constraints;
    const tasks       = meta?.tasks;
    const grpIds      = nodeGroupIds[id] ?? [];
    lines.push(`  [${id}]  ${name}  (${role})`);
    if (summary)      lines.push(`         ${summary}`);
    if (constraints)  lines.push(`         Constraints: ${constraints}`);
    if (conns.length) lines.push(`         Connections: ${conns.join(', ')}`);
    lines.push(`         Groups: ${grpIds.length ? grpIds.join(', ') : '–'}`);
    formatTasks(tasks);
    lines.push('');
  });

  customNodes.forEach(n => {
    const meta        = overrides[n.id];
    const name        = meta?.name        ?? n.label;
    const role        = meta?.role        ?? n.role;
    const summary     = meta?.summary     ?? '';
    const conns       = meta?.connections ?? [];
    const constraints = meta?.constraints;
    const tasks       = meta?.tasks;
    const grpIds      = nodeGroupIds[n.id] ?? [];
    lines.push(`  [${n.id}]  ${name}  (${role})`);
    if (summary)      lines.push(`         ${summary}`);
    if (constraints)  lines.push(`         Constraints: ${constraints}`);
    if (conns.length) lines.push(`         Connections: ${conns.join(', ')}`);
    lines.push(`         Groups: ${grpIds.length ? grpIds.join(', ') : '–'}`);
    formatTasks(tasks);
    lines.push('');
  });

  // ── EDGES ────────────────────────────────────────────────────────────────────
  const allEdgeEntries = Object.entries(EDGE_DATA);
  const customEdges    = state.customEdges;
  lines.push(`EDGES (${allEdgeEntries.length + customEdges.length})`);

  allEdgeEntries.forEach(([id, e]) => {
    const meta      = overrides[id];
    const name      = meta?.name ?? e.name;
    const hyphenIdx = id.indexOf('-');
    const src       = hyphenIdx !== -1 ? id.slice(0, hyphenIdx) : id;
    const tgt       = hyphenIdx !== -1 ? id.slice(hyphenIdx + 1) : '';
    const srcName   = nameLookup[src] ?? src;
    const tgtName   = tgt ? (nameLookup[tgt] ?? tgt) : '?';
    lines.push(`  [${id}]  ${srcName} → ${tgtName}  "${name}"`);
  });

  customEdges.forEach(e => {
    const meta    = overrides[e.id];
    const name    = meta?.name ?? e.name ?? '';
    const srcName = nameLookup[e.source] ?? e.source;
    const tgtName = nameLookup[e.target] ?? e.target;
    lines.push(`  [${e.id}]  ${srcName} → ${tgtName}  ${name ? `"${name}"` : ''}`);
  });

  lines.push('');

  // ── GROUPS ───────────────────────────────────────────────────────────────────
  lines.push(`GROUPS (${groups.length})`);
  if (groups.length === 0) {
    lines.push('  (none)');
  } else {
    groups.forEach(g => {
      // Collect member node metadata for enriched summary line
      const memberEntries: Array<{ role: string; hasConstraint: boolean }> = [
        ...coreNodes
          .filter(([id]) => g.nodeIds.includes(id))
          .map(([id, n]) => ({
            role:          (overrides[id]?.role ?? n.role).toLowerCase(),
            hasConstraint: !!overrides[id]?.constraints,
          })),
        ...customNodes
          .filter(n => g.nodeIds.includes(n.id))
          .map(n => ({
            role:          (overrides[n.id]?.role ?? n.role).toLowerCase(),
            hasConstraint: !!overrides[n.id]?.constraints,
          })),
      ];

      const memberNames     = g.nodeIds.map(id => nameLookup[id] ?? id).join(', ');
      const roleSummary     = buildRoleSummary(memberEntries.map(m => m.role));
      const constraintCount = memberEntries.filter(m => m.hasConstraint).length;
      const parent          = g.parentGroupId ? `  ⊂ ${g.parentGroupId}` : '';
      const color           = g.color ?? '#6366F1';

      lines.push(`  [${g.id}]  ${g.name}  color:${color}${parent}  →  ${memberNames || '(empty)'}`);
      lines.push(`         Nodes: ${g.nodeIds.length} | Roles: ${roleSummary} | Constraints: ${constraintCount}`);
    });
  }

  return lines.join('\n');
}
