/**
 * db/adapter.ts — SQLite adapter implementing the full ServerGraphState interface.
 * Phase 1: Graph database foundation.
 *
 * Every function mirrors its counterpart in serverState.ts but persists to SQLite.
 * The public API is intentionally identical so the feature-flag gate in serverState
 * can delegate transparently.
 */

import { getDb, persistDbRef } from './index';
import type {
  ServerGraphState,
  NodePosition,
  CustomNodeConfig,
  CustomEdgeConfig,
  GlobalSettings,
  WorkflowGroup,
  NodeTask,
} from '../serverState';
import { NODE_DATA } from '../constants';

// ── Helpers ──────────────────────────────────────────────────────────────────

function jsonParse<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

function resolveNodeNameDb(nodeId: string): string {
  const coreNode = NODE_DATA[nodeId];
  if (coreNode) return coreNode.name;
  const db = getDb();
  const row = db.prepare('SELECT label FROM nodes WHERE id = ?').get(nodeId) as { label: string } | undefined;
  return row?.label ?? nodeId;
}

function touchLastUpdated(): void {
  const db = getDb();
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('lastUpdated', ?)").run(
    JSON.stringify(Date.now())
  );
}

function getLastUpdated(): number {
  const db = getDb();
  const row = db.prepare("SELECT value FROM settings WHERE key = 'lastUpdated'").get() as { value: string } | undefined;
  return row ? jsonParse<number>(row.value, Date.now()) : Date.now();
}

// ── Read: Assemble full ServerGraphState from DB ─────────────────────────────

function readPositions(view: string, isOriginal: boolean): Record<string, NodePosition> {
  const db = getDb();
  const rows = db.prepare(
    'SELECT node_id, x, y, z FROM positions WHERE view = ? AND is_original = ?'
  ).all(view, isOriginal ? 1 : 0) as Array<{ node_id: string; x: number; y: number; z: number | null }>;

  const result: Record<string, NodePosition> = {};
  for (const r of rows) {
    result[r.node_id] = { x: r.x, y: r.y, ...(r.z != null ? { z: r.z } : {}) };
  }
  return result;
}

function readCustomNodes(): CustomNodeConfig[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM nodes').all() as Array<{
    id: string; label: string; label_initials: string; node_type: string;
    role: string; source: string | null; text_color: string | null; output_delay: number | null;
  }>;
  return rows.map(r => ({
    id: r.id,
    label: r.label,
    labelInitials: r.label_initials,
    nodeType: r.node_type as 'neural' | 'eco',
    role: r.role as 'person' | 'tool' | 'external' | 'output',
    position: readPositions('baseline', false)[r.id] ?? { x: 400, y: 300 },
    ...(r.source ? { source: r.source as 'ai-generated' | 'user-added' } : {}),
    ...(r.text_color ? { textColor: r.text_color } : {}),
    ...(r.output_delay != null ? { outputDelay: r.output_delay } : {}),
  }));
}

function readCustomEdges(): CustomEdgeConfig[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM edges').all() as Array<{
    id: string; source: string; target: string; sequence: number | null;
    weight: number | null; is_custom: number; is_improvement_only: number;
    name: string | null; curve_tension: number | null; z_layer: number | null;
  }>;
  return rows.map(r => ({
    id: r.id,
    source: r.source,
    target: r.target,
    ...(r.sequence != null ? { sequence: r.sequence } : {}),
    ...(r.weight != null ? { weight: r.weight } : {}),
    ...(r.is_custom ? { isCustom: true } : {}),
    ...(r.is_improvement_only ? { isImprovementOnly: true } : {}),
    ...(r.name ? { name: r.name } : {}),
    ...(r.curve_tension != null ? { curveTension: r.curve_tension } : {}),
    ...(r.z_layer != null ? { zLayer: r.z_layer } : {}),
  }));
}

function readSettings(): GlobalSettings {
  const db = getDb();

  // Read simple settings
  const getVal = (key: string) => {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value;
  };

  const nodePause = jsonParse<number>(getVal('nodePause'), 1.0);
  const edgeWeightOverrides = jsonParse<Record<string, { sequence?: number; weight?: number }>>(
    getVal('edgeWeightOverrides'), {}
  );
  const nodeDelayOverrides = jsonParse<Record<string, number>>(getVal('nodeDelayOverrides'), {});
  const ecoEdgeDensity = jsonParse<'normal' | 'dense' | 'ultra' | undefined>(getVal('ecoEdgeDensity'), undefined);
  const hiddenCoreNodes = jsonParse<string[] | undefined>(getVal('hiddenCoreNodes'), undefined);

  // Read metadata overrides from dedicated table
  const metaRows = db.prepare('SELECT * FROM metadata').all() as Array<{
    node_id: string; name: string | null; role: string | null; status: string | null;
    status_color: string | null; summary: string | null; constraints: string | null;
    processes: string | null; connections: string | null;
  }>;

  const metadataOverrides: GlobalSettings['metadataOverrides'] = {};
  for (const r of metaRows) {
    const tasks = db.prepare('SELECT * FROM node_tasks WHERE node_id = ?').all(r.node_id) as Array<{
      id: string; title: string; status: string; priority: string; due_date: string | null; note: string | null;
    }>;

    metadataOverrides[r.node_id] = {
      ...(r.name ? { name: r.name } : {}),
      ...(r.role ? { role: r.role } : {}),
      ...(r.status ? { status: r.status } : {}),
      ...(r.status_color ? { statusColor: r.status_color } : {}),
      ...(r.summary ? { summary: r.summary } : {}),
      ...(r.constraints ? { constraints: r.constraints } : {}),
      ...(r.processes ? { processes: jsonParse<string[]>(r.processes, []) } : {}),
      ...(r.connections ? { connections: jsonParse<string[]>(r.connections, []) } : {}),
      ...(tasks.length ? {
        tasks: tasks.map(t => ({
          id: t.id,
          title: t.title,
          status: t.status as NodeTask['status'],
          priority: t.priority as NodeTask['priority'],
          ...(t.due_date ? { dueDate: t.due_date } : {}),
          ...(t.note ? { note: t.note } : {}),
        }))
      } : {}),
    };
  }

  // Read groups
  const groupRows = db.prepare('SELECT * FROM groups_').all() as Array<{
    id: string; name: string; color: string; parent_group_id: string | null;
  }>;

  const workflowGroups: WorkflowGroup[] = groupRows.map(g => {
    const members = db.prepare('SELECT node_id FROM group_members WHERE group_id = ?').all(g.id) as Array<{ node_id: string }>;
    return {
      id: g.id,
      name: g.name,
      color: g.color,
      nodeIds: members.map(m => m.node_id),
      ...(g.parent_group_id ? { parentGroupId: g.parent_group_id } : {}),
    };
  });

  return {
    nodePause,
    edgeWeightOverrides,
    nodeDelayOverrides,
    metadataOverrides,
    ...(ecoEdgeDensity ? { ecoEdgeDensity } : {}),
    ...(workflowGroups.length ? { workflowGroups } : {}),
    ...(hiddenCoreNodes ? { hiddenCoreNodes } : {}),
  };
}

export function getGraphStateFromDb(): ServerGraphState {
  persistDbRef();
  return {
    baselinePositions:           readPositions('baseline', false),
    ecosystemPositions:          readPositions('ecosystem', false),
    originalBaselinePositions:   readPositions('baseline', true),
    originalEcosystemPositions:  readPositions('ecosystem', true),
    customNodes:                 readCustomNodes(),
    customEdges:                 readCustomEdges(),
    settings:                    readSettings(),
    lastUpdated:                 getLastUpdated(),
  };
}

// ── Write: Individual mutations ──────────────────────────────────────────────

export function updateNodePositionInDb(view: 'baseline' | 'ecosystem', nodeId: string, pos: NodePosition): void {
  const db = getDb();
  db.prepare(`
    INSERT OR REPLACE INTO positions (node_id, view, x, y, z, is_original)
    VALUES (?, ?, ?, ?, ?, 0)
  `).run(nodeId, view, pos.x, pos.y, pos.z ?? null);
  touchLastUpdated();
}

export function addCustomNodeToDb(node: CustomNodeConfig): void {
  const db = getDb();
  db.prepare(`
    INSERT OR REPLACE INTO nodes (id, label, label_initials, node_type, role, source, text_color, output_delay)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(node.id, node.label, node.labelInitials, node.nodeType, node.role,
    node.source ?? null, node.textColor ?? null, node.outputDelay ?? null);

  // Also store position
  db.prepare(`
    INSERT OR REPLACE INTO positions (node_id, view, x, y, z, is_original)
    VALUES (?, 'baseline', ?, ?, ?, 0)
  `).run(node.id, node.position.x, node.position.y, node.position.z ?? null);

  touchLastUpdated();
}

export function addCustomEdgeToDb(edge: CustomEdgeConfig): void {
  const db = getDb();
  db.prepare(`
    INSERT OR REPLACE INTO edges (id, source, target, sequence, weight, is_custom, is_improvement_only, name, curve_tension, z_layer)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    edge.id, edge.source, edge.target,
    edge.sequence ?? null, edge.weight ?? 1.0,
    edge.isCustom ? 1 : 0, edge.isImprovementOnly ? 1 : 0,
    edge.name ?? null, edge.curveTension ?? null, edge.zLayer ?? null,
  );

  // Sync connections metadata
  const targetName = resolveNodeNameDb(edge.target);
  const meta = db.prepare('SELECT connections FROM metadata WHERE node_id = ?').get(edge.source) as { connections: string | null } | undefined;
  const conns: string[] = jsonParse<string[]>(meta?.connections, []);
  if (!conns.includes(targetName)) {
    conns.push(targetName);
    db.prepare(`
      INSERT INTO metadata (node_id, connections) VALUES (?, ?)
      ON CONFLICT(node_id) DO UPDATE SET connections = excluded.connections
    `).run(edge.source, JSON.stringify(conns));
  }

  touchLastUpdated();
}

export function updateEdgeParamsInDb(edgeId: string, params: { sequence?: number; weight?: number; isImprovementOnly?: boolean }): void {
  const db = getDb();
  const edge = db.prepare('SELECT * FROM edges WHERE id = ?').get(edgeId) as { id: string } | undefined;
  if (edge) {
    if (params.sequence !== undefined)
      db.prepare('UPDATE edges SET sequence = ? WHERE id = ?').run(params.sequence, edgeId);
    if (params.weight !== undefined)
      db.prepare('UPDATE edges SET weight = ? WHERE id = ?').run(params.weight, edgeId);
    if (params.isImprovementOnly !== undefined)
      db.prepare('UPDATE edges SET is_improvement_only = ? WHERE id = ?').run(params.isImprovementOnly ? 1 : 0, edgeId);
  }

  // Also store in settings overrides
  const existing = db.prepare("SELECT value FROM settings WHERE key = 'edgeWeightOverrides'").get() as { value: string } | undefined;
  const overrides = jsonParse<Record<string, { sequence?: number; weight?: number }>>(existing?.value, {});
  overrides[edgeId] = { ...(overrides[edgeId] || {}), ...params };
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('edgeWeightOverrides', ?)").run(JSON.stringify(overrides));

  touchLastUpdated();
}

export function updateNodeDelayInDb(nodeId: string, delay: number): void {
  const db = getDb();
  const existing = db.prepare("SELECT value FROM settings WHERE key = 'nodeDelayOverrides'").get() as { value: string } | undefined;
  const overrides = jsonParse<Record<string, number>>(existing?.value, {});
  overrides[nodeId] = delay;
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('nodeDelayOverrides', ?)").run(JSON.stringify(overrides));
  touchLastUpdated();
}

export function updateSettingsInDb(partial: Partial<GlobalSettings>): void {
  const db = getDb();
  // Store simple settings as JSON key-value pairs
  for (const [key, value] of Object.entries(partial)) {
    if (key === 'metadataOverrides' || key === 'workflowGroups') continue; // handled separately
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(key, JSON.stringify(value));
  }
  touchLastUpdated();
}

export function updateMetadataInDb(id: string, patch: {
  name?: string; role?: string; status?: string;
  statusColor?: string; summary?: string; constraints?: string;
  processes?: string[]; connections?: string[];
  tasks?: NodeTask[];
}): void {
  const db = getDb();

  // Upsert metadata row
  const existing = db.prepare('SELECT * FROM metadata WHERE node_id = ?').get(id) as Record<string, string | null> | undefined;
  db.prepare(`
    INSERT INTO metadata (node_id, name, role, status, status_color, summary, constraints, processes, connections)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(node_id) DO UPDATE SET
      name = COALESCE(excluded.name, metadata.name),
      role = COALESCE(excluded.role, metadata.role),
      status = COALESCE(excluded.status, metadata.status),
      status_color = COALESCE(excluded.status_color, metadata.status_color),
      summary = COALESCE(excluded.summary, metadata.summary),
      constraints = COALESCE(excluded.constraints, metadata.constraints),
      processes = COALESCE(excluded.processes, metadata.processes),
      connections = COALESCE(excluded.connections, metadata.connections)
  `).run(
    id,
    patch.name ?? null,
    patch.role ?? null,
    patch.status ?? null,
    patch.statusColor ?? null,
    patch.summary ?? null,
    patch.constraints ?? null,
    patch.processes ? JSON.stringify(patch.processes) : null,
    patch.connections ? JSON.stringify(patch.connections) : null,
  );

  // Handle tasks
  if (patch.tasks) {
    db.prepare('DELETE FROM node_tasks WHERE node_id = ?').run(id);
    const insertTask = db.prepare(`
      INSERT INTO node_tasks (id, node_id, title, status, priority, due_date, note)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const t of patch.tasks) {
      insertTask.run(t.id, id, t.title, t.status, t.priority, t.dueDate ?? null, t.note ?? null);
    }
  }

  touchLastUpdated();
}

export function removeNodeFromDb(nodeId: string): void {
  const db = getDb();
  const txn = db.transaction(() => {
    db.prepare('DELETE FROM nodes WHERE id = ?').run(nodeId);
    db.prepare('DELETE FROM edges WHERE source = ? OR target = ?').run(nodeId, nodeId);
    db.prepare('DELETE FROM positions WHERE node_id = ?').run(nodeId);
    db.prepare('DELETE FROM metadata WHERE node_id = ?').run(nodeId);
    db.prepare('DELETE FROM node_tasks WHERE node_id = ?').run(nodeId);
    db.prepare('DELETE FROM group_members WHERE node_id = ?').run(nodeId);
    touchLastUpdated();
  });
  txn();
}

export function removeEdgeFromDb(edgeId: string): void {
  const db = getDb();
  const edge = db.prepare('SELECT source, target FROM edges WHERE id = ?').get(edgeId) as { source: string; target: string } | undefined;

  if (edge) {
    // Remove from connections metadata
    const targetName = resolveNodeNameDb(edge.target);
    const meta = db.prepare('SELECT connections FROM metadata WHERE node_id = ?').get(edge.source) as { connections: string | null } | undefined;
    if (meta?.connections) {
      const conns = jsonParse<string[]>(meta.connections, []).filter(c => c !== targetName);
      db.prepare('UPDATE metadata SET connections = ? WHERE node_id = ?').run(JSON.stringify(conns), edge.source);
    }
  }

  db.prepare('DELETE FROM edges WHERE id = ?').run(edgeId);

  // Clean settings overrides
  const existing = db.prepare("SELECT value FROM settings WHERE key = 'edgeWeightOverrides'").get() as { value: string } | undefined;
  if (existing) {
    const overrides = jsonParse<Record<string, unknown>>(existing.value, {});
    delete overrides[edgeId];
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('edgeWeightOverrides', ?)").run(JSON.stringify(overrides));
  }

  touchLastUpdated();
}

export function importStateToDb(data: {
  baselinePositions: Record<string, NodePosition>;
  ecosystemPositions: Record<string, NodePosition>;
  customNodes: CustomNodeConfig[];
  customEdges: CustomEdgeConfig[];
  settings?: Partial<GlobalSettings>;
}): void {
  const db = getDb();
  const txn = db.transaction(() => {
    // Clear existing data
    db.prepare('DELETE FROM nodes').run();
    db.prepare('DELETE FROM edges').run();
    db.prepare('DELETE FROM positions').run();
    db.prepare('DELETE FROM metadata').run();
    db.prepare('DELETE FROM node_tasks').run();
    db.prepare('DELETE FROM groups_').run();
    db.prepare('DELETE FROM group_members').run();

    // Insert nodes
    const insertNode = db.prepare(`
      INSERT OR REPLACE INTO nodes (id, label, label_initials, node_type, role, source, text_color, output_delay)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const n of data.customNodes) {
      insertNode.run(n.id, n.label, n.labelInitials, n.nodeType, n.role,
        n.source ?? null, n.textColor ?? null, n.outputDelay ?? null);
    }

    // Insert edges
    const insertEdge = db.prepare(`
      INSERT OR REPLACE INTO edges (id, source, target, sequence, weight, is_custom, is_improvement_only, name, curve_tension, z_layer)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const e of data.customEdges) {
      insertEdge.run(e.id, e.source, e.target, e.sequence ?? null, e.weight ?? 1.0,
        e.isCustom ? 1 : 0, e.isImprovementOnly ? 1 : 0,
        e.name ?? null, e.curveTension ?? null, e.zLayer ?? null);
    }

    // Insert positions (current + original snapshot)
    const insertPos = db.prepare(`
      INSERT OR REPLACE INTO positions (node_id, view, x, y, z, is_original)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const [id, pos] of Object.entries(data.baselinePositions)) {
      insertPos.run(id, 'baseline', pos.x, pos.y, pos.z ?? null, 0);
      insertPos.run(id, 'baseline', pos.x, pos.y, pos.z ?? null, 1); // original snapshot
    }
    for (const [id, pos] of Object.entries(data.ecosystemPositions)) {
      insertPos.run(id, 'ecosystem', pos.x, pos.y, pos.z ?? null, 0);
      insertPos.run(id, 'ecosystem', pos.x, pos.y, pos.z ?? null, 1);
    }

    // Import settings
    if (data.settings) {
      const { metadataOverrides, workflowGroups, ...simpleSettings } = data.settings;

      for (const [key, value] of Object.entries(simpleSettings)) {
        db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(key, JSON.stringify(value));
      }

      // Import metadata overrides
      if (metadataOverrides) {
        for (const [nodeId, meta] of Object.entries(metadataOverrides)) {
          db.prepare(`
            INSERT OR REPLACE INTO metadata (node_id, name, role, status, status_color, summary, constraints, processes, connections)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            nodeId, meta.name ?? null, meta.role ?? null, meta.status ?? null,
            meta.statusColor ?? null, meta.summary ?? null, meta.constraints ?? null,
            meta.processes ? JSON.stringify(meta.processes) : null,
            meta.connections ? JSON.stringify(meta.connections) : null,
          );

          if (meta.tasks) {
            const insertTask = db.prepare(`
              INSERT INTO node_tasks (id, node_id, title, status, priority, due_date, note)
              VALUES (?, ?, ?, ?, ?, ?, ?)
            `);
            for (const t of meta.tasks) {
              insertTask.run(t.id, nodeId, t.title, t.status, t.priority, t.dueDate ?? null, t.note ?? null);
            }
          }
        }
      }

      // Import groups
      if (workflowGroups) {
        const insertGroup = db.prepare(`
          INSERT OR REPLACE INTO groups_ (id, name, color, parent_group_id)
          VALUES (?, ?, ?, ?)
        `);
        const insertMember = db.prepare(`
          INSERT OR REPLACE INTO group_members (group_id, node_id) VALUES (?, ?)
        `);
        for (const g of workflowGroups) {
          insertGroup.run(g.id, g.name, g.color, g.parentGroupId ?? null);
          for (const nid of g.nodeIds) {
            insertMember.run(g.id, nid);
          }
        }
      }
    }

    touchLastUpdated();
  });
  txn();
}

export function upsertWorkflowGroupInDb(group: WorkflowGroup): void {
  const db = getDb();
  const txn = db.transaction(() => {
    db.prepare(`
      INSERT OR REPLACE INTO groups_ (id, name, color, parent_group_id)
      VALUES (?, ?, ?, ?)
    `).run(group.id, group.name, group.color, group.parentGroupId ?? null);

    // Replace members
    db.prepare('DELETE FROM group_members WHERE group_id = ?').run(group.id);
    const insert = db.prepare('INSERT INTO group_members (group_id, node_id) VALUES (?, ?)');
    for (const nid of group.nodeIds) {
      insert.run(group.id, nid);
    }
    touchLastUpdated();
  });
  txn();
}

export function deleteWorkflowGroupFromDb(groupId: string): void {
  const db = getDb();
  const txn = db.transaction(() => {
    db.prepare('DELETE FROM groups_ WHERE id = ?').run(groupId);
    db.prepare('DELETE FROM group_members WHERE group_id = ?').run(groupId);
    touchLastUpdated();
  });
  txn();
}

// ── Ego-centric queries (Phase 2 foundation) ────────────────────────────────

export interface EgoCentricContext {
  nodeId: string;
  nodeName: string;
  role: string;
  summary: string;
  constraints?: string;
  tasks: NodeTask[];
  inboundEdges: Array<{ fromId: string; fromName: string; edgeName: string; weight: number }>;
  outboundEdges: Array<{ toId: string; toName: string; edgeName: string; weight: number }>;
  groupMemberships: Array<{ groupId: string; groupName: string; peerNodeIds: string[] }>;
  neighborSummaries: Array<{ id: string; name: string; role: string; summary: string }>;
}

/**
 * Build ego-centric context for a node — only its direct neighbourhood.
 * This is the key token-efficiency mechanism: instead of shipping the full
 * graph to the LLM, each agent sees only its local context (~500–1500 tokens
 * instead of ~50K+ for the full graph).
 */
export function getEgoCentricContext(nodeId: string, state: ServerGraphState): EgoCentricContext {
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

  // Tasks
  const tasks: NodeTask[] = meta?.tasks ?? [];

  // Edges — both core and custom
  const allEdgeIds = Object.keys(
    // Import EDGE_DATA for core edges
    require('../constants').EDGE_DATA
  );

  const inboundEdges: EgoCentricContext['inboundEdges'] = [];
  const outboundEdges: EgoCentricContext['outboundEdges'] = [];
  const neighborIds = new Set<string>();

  // Core edges
  for (const edgeId of allEdgeIds) {
    const hyphen = edgeId.indexOf('-');
    if (hyphen === -1) continue;
    const src = edgeId.slice(0, hyphen);
    const tgt = edgeId.slice(hyphen + 1);
    const edgeData = require('../constants').EDGE_DATA[edgeId];
    const weight = state.settings?.edgeWeightOverrides?.[edgeId]?.weight ?? edgeData.sequence ?? 1;

    if (tgt === nodeId) {
      inboundEdges.push({ fromId: src, fromName: resolveNodeNameDb(src), edgeName: edgeData.name, weight });
      neighborIds.add(src);
    }
    if (src === nodeId) {
      outboundEdges.push({ toId: tgt, toName: resolveNodeNameDb(tgt), edgeName: edgeData.name, weight });
      neighborIds.add(tgt);
    }
  }

  // Custom edges
  for (const edge of state.customEdges) {
    const weight = edge.weight ?? 1;
    if (edge.target === nodeId) {
      inboundEdges.push({ fromId: edge.source, fromName: resolveNodeNameDb(edge.source), edgeName: edge.name ?? '', weight });
      neighborIds.add(edge.source);
    }
    if (edge.source === nodeId) {
      outboundEdges.push({ toId: edge.target, toName: resolveNodeNameDb(edge.target), edgeName: edge.name ?? '', weight });
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

  // Neighbor summaries (1-hop)
  const neighborSummaries = Array.from(neighborIds).map(nid => {
    const cn = NODE_DATA[nid];
    const cm = state.customNodes.find(n => n.id === nid);
    const nm = overrides[nid];
    return {
      id: nid,
      name: nm?.name ?? cn?.name ?? cm?.label ?? nid,
      role: nm?.role ?? cn?.role ?? cm?.role ?? 'unknown',
      summary: nm?.summary ?? cn?.summary ?? '',
    };
  });

  return {
    nodeId, nodeName, role, summary, constraints, tasks,
    inboundEdges, outboundEdges, groupMemberships, neighborSummaries,
  };
}
