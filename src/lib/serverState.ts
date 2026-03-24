/**
 * serverState.ts
 */
import { NODE_DATA } from './constants';
import { hierarchicalLayout, groupAwareLayout } from './layout';

export interface NodePosition {
  x: number;
  y: number;
  z?: number;  // Simulated depth: -1.0 (back) to +1.0 (front). Used only in ecosystem view.
}

export interface CustomNodeConfig {
  id: string;
  labelInitials: string;
  label: string;
  nodeType: 'neural' | 'eco';
  role: 'person' | 'tool' | 'external' | 'output';
  /**
   * Origin of this node:
   * - "ai-generated" — created by the AI parse-workflow flow
   * - "user-added"   — manually added by the user via the Add Node panel
   * Omitted for legacy imported nodes.
   */
  source?: 'ai-generated' | 'user-added';
  textColor?: string;
  position: NodePosition;
  outputDelay?: number; // extra weight applied to outgoing edges from this node
}

export interface CustomEdgeConfig {
  id: string;
  source: string;
  target: string;
  sequence?: number;
  weight?: number;
  isCustom?: boolean;
  isImprovementOnly?: boolean; // only show this edge when improvements mode is ON
  /** Human-readable label for this connection (e.g. from AI parse or user). */
  name?: string;
  /** Curve tension for MiroFish arc rendering (0.1–1.0, default 0.6). UI-only hint. */
  curveTension?: number;
  /** Z-layer for edge rendering order (higher = rendered on top). UI-only hint. */
  zLayer?: number;
}

/**
 * A named workflow group — a labelled region covering a subset of nodes in
 * both the process-map and the web-map views.  Rendered as a coloured
 * bounding-box behind the member nodes so users can visually chunk their
 * workflow into meaningful sub-flows (e.g. "Morning Routine").
 */
export interface WorkflowGroup {
  id: string;
  /** Display name shown inside the region rectangle. */
  name: string;
  /** Hex colour used for the fill and border of the region (e.g. "#6366F1"). */
  color: string;
  /** IDs of nodes that belong to this group. */
  nodeIds: string[];
  /**
   * If set, this group is a sub-group nested visually inside the parent group.
   * The parent group's region expands to encompass all its children's regions.
   */
  parentGroupId?: string;
}

/**
 * A self-owned task / to-do attached to a node (shown as interactive dots
 * around the node in the ecosystem web-map view).
 */
export interface NodeTask {
  id: string;
  /** Short task title, shown on the dot popup. */
  title: string;
  /** Workflow status of this task. */
  status: "todo" | "in-progress" | "done" | "blocked" | "review";
  /** Subjective priority. */
  priority: "low" | "medium" | "high";
  /** ISO date string (YYYY-MM-DD), optional. */
  dueDate?: string;
  /** Free-form note / description. */
  note?: string;
}

export interface GlobalSettings {
  nodePause: number;
  edgeWeightOverrides: Record<string, { sequence?: number; weight?: number }>;
  nodeDelayOverrides: Record<string, number>;
  metadataOverrides: Record<string, {
    name?: string; role?: string; status?: string;
    statusColor?: string; summary?: string;
    processes?: string[]; connections?: string[];
    /** Operational / compliance / technical constraints for this entity. */
    constraints?: string;
    /** Self-assigned tasks shown as interactive dots in the web-map view. */
    tasks?: NodeTask[];
  }>;
  /** Visual mode for the ecosystem web-map: controls edge density rendering. */
  ecoEdgeDensity?: "normal" | "dense" | "ultra";
  /** Named workflow groups — rendered as coloured regions behind their nodes. */
  workflowGroups?: WorkflowGroup[];
  /**
   * Core node IDs to hide in both views.  Used by templates that replace the
   * default Ridgeview nodes with their own custom node set.
   */
  hiddenCoreNodes?: string[];
}

export interface ServerGraphState {
  baselinePositions:  Record<string, NodePosition>;
  ecosystemPositions: Record<string, NodePosition>;
  /** Snapshot of positions when the last workflow was imported — used by Reset Layout. */
  originalBaselinePositions:  Record<string, NodePosition>;
  originalEcosystemPositions: Record<string, NodePosition>;
  customNodes: CustomNodeConfig[];
  customEdges: CustomEdgeConfig[];
  settings: GlobalSettings;
  lastUpdated: number;
  /** Hash of current positions — used by client to skip re-renders when nothing moved. */
  _positionsHash?: string;
}

// ── Default positions matching the prototype exactly ──────────────────────────
const DEFAULT_BASELINE: Record<string, NodePosition> = {
  nav:    { x: 80,  y: 250 },
  script: { x: 280, y: 80  },
  db:     { x: 280, y: 420 },
  xy:     { x: 280, y: 250 },
  mary:   { x: 480, y: 250 },
  ed:     { x: 680, y: 150 },
  cy:     { x: 880, y: 250 },
};

// MiroFish two-cluster layout: left cluster (nav+xy) and right cluster (mary+ed)
// Positioned to fit a ~700px canvas; satellites radiate outward from each center
const DEFAULT_ECOSYSTEM: Record<string, NodePosition> = {
  nav:  { x: 140, y: 195, z: -0.3 },   // left cluster upper — magenta external
  xy:   { x: 175, y: 295, z: 0.0  },   // left cluster lower — cyan hub
  mary: { x: 530, y: 165, z: 0.4  },   // right cluster upper — violet collaborator
  ed:   { x: 500, y: 290, z: -0.5 },   // right cluster lower — amber bottleneck
};

const DEFAULT_SETTINGS: GlobalSettings = {
  nodePause: 1.0,
  edgeWeightOverrides: {},
  nodeDelayOverrides: {},
  metadataOverrides: {},
};

function createInitialState(): ServerGraphState {
  return {
    baselinePositions:  { ...DEFAULT_BASELINE },
    ecosystemPositions: { ...DEFAULT_ECOSYSTEM },
    originalBaselinePositions:  { ...DEFAULT_BASELINE },
    originalEcosystemPositions: { ...DEFAULT_ECOSYSTEM },
    customNodes: [],
    customEdges: [],
    settings: { ...DEFAULT_SETTINGS },
    lastUpdated: Date.now(),
  };
}

// Global singleton — survives hot-reload
declare global {
  // eslint-disable-next-line no-var
  var __graphState: ServerGraphState | undefined;
}

if (!global.__graphState) {
  global.__graphState = createInitialState();
}
// Migrate old state that might be missing `settings`
if (!global.__graphState.settings) {
  (global.__graphState as ServerGraphState).settings = {
    ...DEFAULT_SETTINGS,
    edgeWeightOverrides: {},
    nodeDelayOverrides: {},
  };
}
// Migrate old state that might be missing original positions
if (!global.__graphState.originalBaselinePositions) {
  (global.__graphState as ServerGraphState).originalBaselinePositions  = { ...global.__graphState.baselinePositions };
  (global.__graphState as ServerGraphState).originalEcosystemPositions = { ...global.__graphState.ecosystemPositions };
}

// ── Public API ────────────────────────────────────────────────────────────────

// Track the lastUpdated timestamp when the hash was last computed so we
// only re-hash when something actually changed — avoids O(n) JSON stringify
// on every 3-second poll when the graph is idle.
let _hashCachedAt = 0;

export function getGraphState(): ServerGraphState {
  const state = global.__graphState!;
  if (state.lastUpdated !== _hashCachedAt) {
    const hashInput = JSON.stringify(state.ecosystemPositions) + JSON.stringify(state.baselinePositions);
    let h = 0;
    for (const c of hashInput) h = (Math.imul(31, h) + c.charCodeAt(0)) | 0;
    state._positionsHash = h.toString(16);
    _hashCachedAt = state.lastUpdated;
  }
  return state;
}

export function updateNodePosition(
  view: 'baseline' | 'ecosystem',
  nodeId: string,
  pos: NodePosition
) {
  const state = global.__graphState!;
  if (view === 'baseline') {
    state.baselinePositions[nodeId] = pos;
  } else {
    state.ecosystemPositions[nodeId] = pos;
  }
  state.lastUpdated = Date.now();
}

export function addCustomNode(node: CustomNodeConfig) {
  const state = global.__graphState!;
  state.customNodes = state.customNodes.filter(n => n.id !== node.id);
  state.customNodes.push(node);
  state.lastUpdated = Date.now();
}

/** Resolve a node ID to its display name (core or custom). Falls back to the id itself. */
function resolveNodeName(nodeId: string): string {
  const coreNode = NODE_DATA[nodeId];
  if (coreNode) return coreNode.name;
  const customNode = global.__graphState!.customNodes.find(n => n.id === nodeId);
  return customNode?.label ?? nodeId;
}

export function addCustomEdge(edge: CustomEdgeConfig) {
  const state = global.__graphState!;
  state.customEdges = state.customEdges.filter(e => e.id !== edge.id);
  state.customEdges.push(edge);

  // Sync back to metadata: add target node name to source's connections list
  const sourceId = edge.source;
  const targetId = edge.target;
  const targetName = resolveNodeName(targetId);

  if (!state.settings.metadataOverrides) state.settings.metadataOverrides = {};
  if (!state.settings.metadataOverrides[sourceId]) {
    // Find initial connections from NODE_DATA if core
    const coreSource = NODE_DATA[sourceId];
    state.settings.metadataOverrides[sourceId] = {
      connections: coreSource ? [...coreSource.connections] : []
    };
  }

  const currentConns = state.settings.metadataOverrides[sourceId].connections || [];
  if (!currentConns.includes(targetName)) {
    state.settings.metadataOverrides[sourceId].connections = [...currentConns, targetName];
  }

  state.lastUpdated = Date.now();
}

export function updateEdgeParams(edgeId: string, params: { sequence?: number; weight?: number; isImprovementOnly?: boolean }) {
  const state = global.__graphState!;
  
  // 1. Update settings overrides (for both builtin and custom)
  if (!state.settings.edgeWeightOverrides) state.settings.edgeWeightOverrides = {};
  const { isImprovementOnly, ...rest } = params;
  state.settings.edgeWeightOverrides[edgeId] = {
    ...(state.settings.edgeWeightOverrides[edgeId] || {}),
    ...rest,
  };

  // 2. If it's a custom edge, update the flag on the edge itself
  const customEdge = state.customEdges.find(e => e.id === edgeId);
  if (customEdge) {
    if (params.sequence !== undefined) customEdge.sequence = params.sequence;
    if (params.weight !== undefined) customEdge.weight = params.weight;
    if (params.isImprovementOnly !== undefined) customEdge.isImprovementOnly = params.isImprovementOnly;
  }

  state.lastUpdated = Date.now();
}

export function updateNodeDelay(nodeId: string, delay: number) {
  const state = global.__graphState!;
  if (!state.settings.nodeDelayOverrides) state.settings.nodeDelayOverrides = {};
  state.settings.nodeDelayOverrides[nodeId] = delay;
  state.lastUpdated = Date.now();
}

export function updateSettings(partial: Partial<GlobalSettings>) {
  const state = global.__graphState!;
  state.settings = { ...state.settings, ...partial };
  state.lastUpdated = Date.now();
}

export function updateMetadata(id: string, patch: {
  name?: string; role?: string; status?: string;
  statusColor?: string; summary?: string; constraints?: string;
  processes?: string[]; connections?: string[];
  tasks?: NodeTask[];
}) {
  const state = global.__graphState!;
  if (!state.settings.metadataOverrides) state.settings.metadataOverrides = {};
  state.settings.metadataOverrides[id] = {
    ...(state.settings.metadataOverrides[id] || {}),
    ...patch,
  };

  // If connections are updated, sync the edges
  if (patch.connections) {
    syncEdgesFromConnections(id, patch.connections);
  }

  state.lastUpdated = Date.now();
}

function resolveNodeId(query: string): string | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;

  // 1. Check core nodes by ID or Name
  for (const [id, data] of Object.entries(NODE_DATA)) {
    if (id.toLowerCase() === q || data.name.toLowerCase() === q) return id;
  }

  // 2. Check custom nodes by ID or Name
  const state = global.__graphState!;
  for (const node of state.customNodes) {
    if (node.id.toLowerCase() === q || node.label.toLowerCase() === q) return node.id;
  }

  return null;
}

function syncEdgesFromConnections(sourceId: string, connections: string[]) {
  const state = global.__graphState!;
  const targetIds = new Set(connections.map(resolveNodeId).filter(Boolean) as string[]);

  // 1. Remove existing custom edges that are no longer in the list
  state.customEdges = state.customEdges.filter(edge => {
    if (edge.source !== sourceId) return true;
    return targetIds.has(edge.target);
  });

  // 2. Add new edges for items in the list that don't exist yet
  targetIds.forEach(targetId => {
    if (targetId === sourceId) return; // No self-loops
    const existsInCustom = state.customEdges.find(e => e.source === sourceId && e.target === targetId);
    // Note: We don't check static EDGE_DATA here because updateMetadata is usually for manual/custom routing overrides.
    if (!existsInCustom) {
      const edgeId = `${sourceId}-${targetId}`;
      state.customEdges.push({
        id: edgeId,
        source: sourceId,
        target: targetId,
        sequence: 1,
        isCustom: true,
        weight: 1
      });
    }
  });
}

export function removeNode(nodeId: string) {
  const state = global.__graphState!;
  state.customNodes = state.customNodes.filter((n) => n.id !== nodeId);
  state.customEdges = state.customEdges.filter(
    (e) => e.source !== nodeId && e.target !== nodeId
  );
  delete state.baselinePositions[nodeId];
  delete state.ecosystemPositions[nodeId];
  delete state.settings.nodeDelayOverrides[nodeId];
  delete state.settings.metadataOverrides?.[nodeId];
  state.lastUpdated = Date.now();
}

export function removeEdge(edgeId: string) {
  const state = global.__graphState!;
  const edge = state.customEdges.find((e) => e.id === edgeId);
  
  if (edge) {
    const sourceId = edge.source;
    const targetName = resolveNodeName(edge.target);

    // Remove from metadata overrides
    if (state.settings.metadataOverrides?.[sourceId]?.connections) {
      state.settings.metadataOverrides[sourceId].connections = 
        state.settings.metadataOverrides[sourceId].connections.filter(c => c !== targetName);
    }
  }

  state.customEdges = state.customEdges.filter((e) => e.id !== edgeId);
  delete state.settings.edgeWeightOverrides[edgeId];
  state.lastUpdated = Date.now();
}

export function importState(data: {
  baselinePositions: Record<string, NodePosition>;
  ecosystemPositions: Record<string, NodePosition>;
  customNodes: CustomNodeConfig[];
  customEdges: CustomEdgeConfig[];
  settings?: Partial<GlobalSettings>;
}) {
  const state = global.__graphState!;
  state.baselinePositions  = { ...DEFAULT_BASELINE,   ...data.baselinePositions };
  state.ecosystemPositions = { ...DEFAULT_ECOSYSTEM,  ...data.ecosystemPositions };
  // Snapshot for Reset Layout
  state.originalBaselinePositions  = { ...state.baselinePositions };
  state.originalEcosystemPositions = { ...state.ecosystemPositions };
  state.customNodes  = data.customNodes;
  state.customEdges  = data.customEdges;
  if (data.settings) state.settings = { ...DEFAULT_SETTINGS, ...data.settings };
  state.lastUpdated  = Date.now();
}

/** Create or fully replace a workflow group by id. */
export function upsertWorkflowGroup(group: WorkflowGroup) {
  const state = global.__graphState!;
  if (!state.settings.workflowGroups) state.settings.workflowGroups = [];
  state.settings.workflowGroups = state.settings.workflowGroups.filter((g) => g.id !== group.id);
  state.settings.workflowGroups.push(group);
  state.lastUpdated = Date.now();
}

/** Remove a workflow group by id. */
export function deleteWorkflowGroup(groupId: string) {
  const state = global.__graphState!;
  if (!state.settings.workflowGroups) return;
  state.settings.workflowGroups = state.settings.workflowGroups.filter((g) => g.id !== groupId);
  state.lastUpdated = Date.now();
}

/**
 * Incremental layout — place a small set of new nodes relative to their
 * connected neighbours instead of re-running the full hierarchical layout.
 *
 * Used by handleApplyUpdate when an AI Update adds ≤5 nodes and removes none,
 * to avoid jarring full re-renders of large existing graphs.
 */
export function incrementalLayout(newNodeIds: string[]) {
  const state = global.__graphState!;
  if (newNodeIds.length === 0) return;

  const existing = state.baselinePositions;
  const newSet   = new Set(newNodeIds);

  for (const nodeId of newNodeIds) {
    if (existing[nodeId]) continue; // already has a position — leave it

    // Find IDs of existing (non-new) nodes connected to this node via custom edges.
    const connectedIds = state.customEdges
      .filter(e => (e.source === nodeId || e.target === nodeId))
      .map(e => (e.source === nodeId ? e.target : e.source))
      .filter(id => !newSet.has(id) && existing[id]);

    if (connectedIds.length > 0) {
      // Place near the centroid of connected existing nodes, offset to the right.
      const cx = connectedIds.reduce((s, id) => s + existing[id].x, 0) / connectedIds.length;
      const cy = connectedIds.reduce((s, id) => s + existing[id].y, 0) / connectedIds.length;
      state.baselinePositions[nodeId] = { x: cx + 180, y: cy + 60 };
    } else {
      // No connections to existing nodes — place near the graph centroid.
      const existingIds = Object.keys(existing).filter(id => !newSet.has(id));
      if (existingIds.length > 0) {
        const cx = existingIds.reduce((s, id) => s + existing[id].x, 0) / existingIds.length;
        const cy = existingIds.reduce((s, id) => s + existing[id].y, 0) / existingIds.length;
        state.baselinePositions[nodeId] = { x: cx + 180, y: cy };
      } else {
        state.baselinePositions[nodeId] = { x: 400, y: 300 };
      }
    }
  }

  state.lastUpdated = Date.now();
}

/** Restore positions to the snapshot taken at last importState call. */
export function resetLayout() {
  const state = global.__graphState!;

  // If we have custom nodes (AI-generated / template workflow), re-run the
  // hierarchical layout from scratch so positions always use the latest algorithm
  // (stagger, overlap resolution, group-aware layout) rather than restoring stale
  // CSV-imported positions.
  if (state.customNodes.length > 0) {
    const nodeCount  = state.customNodes.length;
    const estLayers  = Math.max(3, Math.ceil(nodeCount / 3));
    // Scale canvas proportionally to node count — avoids tiny graphs spreading
    // across a huge 1200px canvas where layer spacing becomes enormous.
    const canvasW    = Math.max(900, nodeCount * 140);
    const canvasH    = Math.max(720,  Math.min(nodeCount, 6) * 150);

    const layoutNodes = state.customNodes.map(n => ({ id: n.id }));
    const layoutEdges = state.customEdges.map(e => ({ source: e.source, target: e.target }));

    let freshPositions = hierarchicalLayout(layoutNodes, layoutEdges, canvasW, canvasH);

    // Re-apply group-aware zone layout so non-sharing groups don't overlap.
    // Pass the full group list — groupAwareLayout handles top-level filtering
    // and recurses into subgroups to collect effective nodeIds.
    const groups = state.settings.workflowGroups ?? [];
    if (groups.length > 0) {
      // Pass layoutEdges so the hub (most-connected) node is used as the
      // gravitational center of the AABB solver.
      freshPositions = groupAwareLayout(freshPositions, groups, canvasW, layoutEdges);
    }

    // Merge: update custom node positions; leave core node positions untouched
    state.baselinePositions = { ...state.baselinePositions, ...freshPositions };
    state.originalBaselinePositions = { ...state.originalBaselinePositions, ...freshPositions };
  } else {
    state.baselinePositions  = { ...state.originalBaselinePositions };
    state.ecosystemPositions = { ...state.originalEcosystemPositions };
  }

  state.lastUpdated = Date.now();
}
