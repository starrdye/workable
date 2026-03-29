/**
 * contextCompressor.ts — Track 14b: Smart Snapshot Trimming
 *
 * When the full workflow snapshot exceeds the safe input budget,
 * produces a compressed representation by applying multiple reduction
 * layers in order until the token estimate fits within the budget.
 *
 * Compression layers (applied sequentially, stopping when budget is met):
 *  1. Task truncation  — >5 tasks per node → keep first 5 + "N more omitted"
 *  2. Core edge strip  — when all core nodes are hidden, strip coreEdges entirely
 *  3. Peripheral trim  — nodes not in any group AND not on any edge get
 *                        their summary capped + constraints/connections dropped
 *  4. Edge label dedup — generic/empty edge name strings are blanked out
 *
 * The `omissions` array is returned so callers can log exactly what was dropped
 * (visible in the AI Debug Log so users understand what context was trimmed).
 */

import type { OptimizeSnapshot } from './snapshotBuilder';

// ── Token estimation ──────────────────────────────────────────────────────────
// Rule of thumb: ~4 characters per token (conservative for mixed English/JSON).
const CHARS_PER_TOKEN = 4;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Safe input budget in tokens.
 * Leaves ~1 500 tokens for the system prompt and ~5 000 for the AI output.
 * Claude Sonnet's context window is 200 k tokens, so this is very conservative —
 * raise if you're consistently hitting compression on legitimate large workflows.
 */
export const SAFE_INPUT_THRESHOLD = 40_000;

// ── Result type ───────────────────────────────────────────────────────────────

export interface CompressionResult {
  /** The (possibly compressed) workflow snapshot JSON string */
  workflowSnapshot: string;
  /** Human-readable descriptions of what was omitted */
  omissions: string[];
  /** True if any compression was applied */
  wasCompressed: boolean;
  /** Token estimate of the original snapshot */
  originalTokenEstimate: number;
  /** Token estimate after compression */
  compressedTokenEstimate: number;
}

// ── Internal snapshot shape ───────────────────────────────────────────────────

interface NodeEntry {
  id: string;
  name: string;
  role: string;
  summary: string;
  constraints?: string;
  connections?: string[];
  groupIds?: string[];
  tasks?: Array<{ id: string; title: string; status: string; priority: string; note?: string }>;
}

interface CoreEdgeEntry {
  id: string;
  name: string;
  sourceName: string;
  targetName: string;
  summary?: string;
}

interface CustomEdgeEntry {
  id: string;
  name: string;
  sourceName: string;
  targetName: string;
}

interface GroupEntry {
  id: string;
  name: string;
  color: string;
  nodeIds: string[];
  members: string[];
  nodeCount: number;
  roleSummary: string;
  constraintCount: number;
}

interface SnapshotData {
  coreNodes:    NodeEntry[];
  coreEdges:    CoreEdgeEntry[];
  customNodes:  NodeEntry[];
  customEdges:  CustomEdgeEntry[];
  groups:       GroupEntry[];
}

// ── Generic labels that carry no meaningful semantic signal ───────────────────
const GENERIC_EDGE_LABELS = new Set([
  '', 'Data Transfer', 'data transfer', 'Provides', 'provides',
  'Connects To', 'connects to', 'Links', 'links',
  'sends', 'receives', 'Sends', 'Receives',
  'Flow', 'flow', 'Link', 'link',
]);

const MAX_TASKS_PER_NODE = 5;
const MAX_SUMMARY_CHARS  = 60;

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Compress a workflow snapshot to fit within `budgetTokens` input tokens.
 *
 * @param snapshot   - Output of `buildOptimizeSnapshot`
 * @param budgetTokens - Token budget (default: SAFE_INPUT_THRESHOLD)
 */
export function compressSnapshot(
  snapshot: OptimizeSnapshot,
  budgetTokens: number = SAFE_INPUT_THRESHOLD,
): CompressionResult {
  const original              = snapshot.workflowSnapshot;
  const originalTokenEstimate = estimateTokens(original);

  // Fast-path: already within budget
  if (originalTokenEstimate <= budgetTokens) {
    return {
      workflowSnapshot:        original,
      omissions:               [],
      wasCompressed:           false,
      originalTokenEstimate,
      compressedTokenEstimate: originalTokenEstimate,
    };
  }

  // Deep-clone the parsed snapshot so we can mutate freely
  const data: SnapshotData = JSON.parse(original);
  const omissions: string[] = [];

  // ── Layer 1: Task truncation ────────────────────────────────────────────────
  let tasksTruncated = 0;
  for (const node of [...data.coreNodes, ...data.customNodes]) {
    if (node.tasks && node.tasks.length > MAX_TASKS_PER_NODE) {
      const extra = node.tasks.length - MAX_TASKS_PER_NODE;
      node.tasks = [
        ...node.tasks.slice(0, MAX_TASKS_PER_NODE),
        {
          id:     'omitted',
          title:  `+${extra} more tasks omitted for context window`,
          status: 'todo',
          priority: 'low',
        },
      ];
      tasksTruncated += extra;
    }
  }
  if (tasksTruncated > 0) {
    omissions.push(`${tasksTruncated} task(s) truncated to ${MAX_TASKS_PER_NODE} per node`);
  }

  let current = JSON.stringify(data, null, 2);
  if (estimateTokens(current) <= budgetTokens) {
    return done(current, omissions, originalTokenEstimate);
  }

  // ── Layer 2: Core edge strip (only when all core nodes are hidden) ──────────
  if (data.coreNodes.length === 0 && data.coreEdges.length > 0) {
    const edgeCount   = data.coreEdges.length;
    data.coreEdges    = [];
    omissions.push(`${edgeCount} core edge(s) stripped (all core nodes are hidden in this workflow)`);

    current = JSON.stringify(data, null, 2);
    if (estimateTokens(current) <= budgetTokens) {
      return done(current, omissions, originalTokenEstimate);
    }
  }

  // ── Layer 3: Peripheral node metadata trim ──────────────────────────────────
  // "Peripheral" = not in any group AND not mentioned by any edge endpoint.
  const groupMemberIds = new Set<string>(data.groups.flatMap(g => g.nodeIds));

  // Collect all node IDs that appear in at least one edge
  const edgeNodeIds = new Set<string>();
  for (const e of data.coreEdges) {
    // Core edge IDs are "src-tgt"; extract both halves
    const sep = e.id.indexOf('-');
    if (sep !== -1) {
      edgeNodeIds.add(e.id.slice(0, sep));
      edgeNodeIds.add(e.id.slice(sep + 1));
    }
  }
  for (const e of data.customEdges) {
    const sep = e.id.lastIndexOf('-');
    if (sep !== -1) {
      edgeNodeIds.add(e.id.slice(0, sep));
      edgeNodeIds.add(e.id.slice(sep + 1));
    }
  }

  let peripheralTrimmed = 0;
  for (const node of [...data.coreNodes, ...data.customNodes]) {
    const isInGroup  = groupMemberIds.has(node.id);
    const isOnEdge   = edgeNodeIds.has(node.id);
    if (!isInGroup && !isOnEdge) {
      // Trim to minimal form
      if (node.summary && node.summary.length > MAX_SUMMARY_CHARS) {
        node.summary = node.summary.slice(0, MAX_SUMMARY_CHARS) + '…';
        peripheralTrimmed++;
      }
      delete node.constraints;
      delete node.connections;
    }
  }
  if (peripheralTrimmed > 0) {
    omissions.push(`${peripheralTrimmed} peripheral node(s) summary trimmed to ${MAX_SUMMARY_CHARS} chars`);
  }

  current = JSON.stringify(data, null, 2);
  if (estimateTokens(current) <= budgetTokens) {
    return done(current, omissions, originalTokenEstimate);
  }

  // ── Layer 4: Generic edge label deduplication ───────────────────────────────
  let edgesStripped = 0;
  for (const edge of data.coreEdges) {
    if (GENERIC_EDGE_LABELS.has(edge.name)) {
      edge.name = '';
      edgesStripped++;
    }
    // Core edges carry a `summary` field that is rarely AI-useful
    delete edge.summary;
  }
  for (const edge of data.customEdges) {
    if (GENERIC_EDGE_LABELS.has(edge.name)) {
      edge.name = '';
      edgesStripped++;
    }
  }
  if (edgesStripped > 0) {
    omissions.push(`${edgesStripped} generic edge label(s) blanked`);
  }

  current = JSON.stringify(data, null, 2);
  return done(current, omissions, originalTokenEstimate);
}

// ── Helper ────────────────────────────────────────────────────────────────────

function done(
  workflowSnapshot: string,
  omissions: string[],
  originalTokenEstimate: number,
): CompressionResult {
  return {
    workflowSnapshot,
    omissions,
    wasCompressed:           omissions.length > 0,
    originalTokenEstimate,
    compressedTokenEstimate: estimateTokens(workflowSnapshot),
  };
}
