/**
 * hermes/layout.ts — Fixed hub-and-spoke layout for the team canvas.
 *
 * You and the orchestrator sit on the top row; workers wrap in rows of four
 * underneath. Deterministic on purpose, so nodes never jump between polls.
 */

import type { HermesEdge, HermesProfile } from './types';
import { HUMAN_ID } from './metrics';
import { hierarchicalLayout } from '@/lib/layout';

export const NODE_W = 200;
export const NODE_H = 92;
const GAP_X = 44;
const TOP_Y = 36;
const WORKER_Y = 214;
/** Extra room below the bus when arrows carry labels (Projects / Replay), so they sit above the board box. */
const WORKER_Y_LABELLED = 252;
const ROW_GAP = 150;
const PER_ROW = 4;

export interface NodeBox { id: string; x: number; y: number }

export interface TeamLayout {
  width: number;
  height: number;
  nodes: Map<string, NodeBox>;
  /** Bounding box of the worker rows, for the board / project boundary. */
  workerBounds: { x: number; y: number; w: number; h: number } | null;
  /** Top of the first worker row (connectors route to it). */
  firstRowY: number;
}

/**
 * `labels`: the connectors carry "N cards" labels (Projects / Replay). The
 * worker row then moves down so the labels sit under the bus and the board
 * box (with its own title) starts below them — never on the same line.
 */
export function layoutTeam(profiles: HermesProfile[], opts: { labels?: boolean } = {}): TeamLayout {
  const hub = profiles.find(p => p.isDefault) ?? null;
  const workers = profiles.filter(p => p !== hub);
  const cols = PER_ROW; // fixed width leaves room for the You → orchestrator label
  const width = cols * NODE_W + (cols + 1) * GAP_X;
  const nodes = new Map<string, NodeBox>();

  if (hub) {
    nodes.set(HUMAN_ID, { id: HUMAN_ID, x: GAP_X, y: TOP_Y });
    nodes.set(hub.id, { id: hub.id, x: (width - NODE_W) / 2, y: TOP_Y });
  }

  const firstRowY = hub ? (opts.labels ? WORKER_Y_LABELLED : WORKER_Y) : TOP_Y;
  const rows = Math.ceil(workers.length / PER_ROW);
  for (let r = 0; r < rows; r++) {
    const row = workers.slice(r * PER_ROW, (r + 1) * PER_ROW);
    const rowW = row.length * NODE_W + (row.length - 1) * GAP_X;
    const startX = (width - rowW) / 2;
    row.forEach((p, i) => nodes.set(p.id, { id: p.id, x: startX + i * (NODE_W + GAP_X), y: firstRowY + r * ROW_GAP }));
  }

  // 14px above the cards (the connectors enter here), a 30px title strip below them.
  const workerBounds = rows
    ? { x: GAP_X / 2, y: firstRowY - 14, w: width - GAP_X, h: (rows - 1) * ROW_GAP + NODE_H + 44 }
    : null;
  const height = rows ? firstRowY + (rows - 1) * ROW_GAP + NODE_H + 56 : TOP_Y + NODE_H + 48;
  return { width, height, nodes, workerBounds, firstRowY };
}

/** SVG path from one node to another: bottom→top when stacked, side→side when level. */
export function edgePath(a: NodeBox, b: NodeBox): string {
  if (Math.abs(a.y - b.y) < NODE_H) {
    const leftToRight = a.x < b.x;
    const x1 = leftToRight ? a.x + NODE_W : a.x, x2 = leftToRight ? b.x : b.x + NODE_W;
    const y1 = a.y + NODE_H / 2, y2 = b.y + NODE_H / 2;
    return `M${x1},${y1} L${x2},${y2}`;
  }
  const down = a.y < b.y;
  const x1 = a.x + NODE_W / 2, y1 = down ? a.y + NODE_H : a.y;
  const x2 = b.x + NODE_W / 2, y2 = down ? b.y : b.y + NODE_H;
  const my = (y1 + y2) / 2;
  return `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`;
}

type Pt = [number, number];
const CORNER = 10;

/** Orthogonal polyline with rounded corners. */
export function roundedPath(pts: Pt[], r = CORNER): string {
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1], [x, y] = pts[i], [nx, ny] = pts[i + 1];
    const inLen = Math.hypot(x - px, y - py), outLen = Math.hypot(nx - x, ny - y);
    const k = Math.min(r, inLen / 2, outLen / 2);
    if (k < 0.5) { d += ` L${x},${y}`; continue; }
    const ax = x - ((x - px) / inLen) * k, ay = y - ((y - py) / inLen) * k;
    const bx = x + ((nx - x) / outLen) * k, by = y + ((ny - y) / outLen) * k;
    d += ` L${ax},${ay} Q${x},${y} ${bx},${by}`;
  }
  const [lx, ly] = pts[pts.length - 1];
  return `${d} L${lx},${ly}`;
}

export interface TreeBranch {
  /** Orchestrator → bus: shared by every branch, always neutral. */
  trunk: string;
  /** Bus → worker, neutral. */
  branch: string;
  /** The last leg into the worker (from its corner), coloured by the latest request. */
  drop: string;
  /** Where a label for this branch reads well. */
  label: { x: number; y: number };
}

/**
 * Org-chart connector from the orchestrator to a worker: straight down to a
 * shared bus, across, and down into the worker. Workers on later rows are
 * reached through the gap to their left so lines never cross a card.
 */
export function treeBranch(hub: NodeBox, w: NodeBox, firstRowY = WORKER_Y): TreeBranch {
  const hx = hub.x + NODE_W / 2, hy = hub.y + NODE_H;
  const bus = hy + (firstRowY - hy) / 2;
  const wx = w.x + NODE_W / 2;
  const trunk = `M${hx},${hy} L${hx},${bus}`;

  let pts: Pt[];
  if (w.y <= firstRowY + 1) {
    pts = [[hx, bus], [wx, bus], [wx, w.y]];
  } else {
    const gx = w.x - GAP_X / 2, lane = w.y - 22;
    pts = [[hx, bus], [gx, bus], [gx, lane], [wx, lane], [wx, w.y]];
  }
  const [, cy] = pts[pts.length - 2];
  // The coloured drop is only the straight part below the last corner, drawn exactly
  // over the grey branch, so the colour change sits on a straight line and lines up.
  // Both stop just short of the card so the arrowhead doesn't sit on its border.
  const end = w.y - 2;
  const branch = roundedPath([...pts.slice(0, -1), [wx, end]]);
  const drop = `M${wx},${cy + CORNER} L${wx},${end}`;
  // Label just under the bus, beside the drop — above the board box on the first row.
  return { trunk, branch, drop, label: { x: wx + 8, y: cy + 15 } };
}

/** Find the drawn edge for a hand-off, and whether the pulse runs against the arrow. */
export function findEdgeFor(edges: HermesEdge[], from: string, to: string): { edge: HermesEdge; reverse: boolean } | null {
  const fwd = edges.find(e => e.source === from && e.target === to);
  if (fwd) return { edge: fwd, reverse: false };
  const rev = edges.find(e => e.source === to && e.target === from);
  return rev ? { edge: rev, reverse: true } : null;
}

/* ------------------------------------------------------------------ */
/* Hybrid layout: org chart for boss → workers, flow for hand-off chains */
/* ------------------------------------------------------------------ */

export type LayoutMode = 'auto' | 'org' | 'flow';

/** True when workers hand cards to each other (a chain the org chart can't show). */
export function hasChains(profiles: HermesProfile[], edges: HermesEdge[]): boolean {
  const hub = profiles.find(p => p.isDefault)?.id;
  const workers = new Set(profiles.filter(p => p.id !== hub).map(p => p.id));
  return edges.some(e => e.kind === 'observed' && workers.has(e.source) && workers.has(e.target));
}

/**
 * Flow layout: Workable's smart layout (hierarchicalLayout, the canvas's
 * layered algorithm) decides each worker's step and its order within the
 * step; the cards are then placed top-down on the same grid as the org chart
 * — You and the orchestrator on top, one row per step below. Built from the
 * roster plus the board's hand-offs (7-day window), so it only changes when
 * the team's shape does, not on every live event.
 */
export function layoutFlow(profiles: HermesProfile[], edges: HermesEdge[], opts: { labels?: boolean } = {}): TeamLayout {
  const hub = profiles.find(p => p.isDefault) ?? null;
  if (!hub) return layoutTeam(profiles, opts);
  const workers = profiles.filter(p => p !== hub);
  const ids = new Set(profiles.map(p => p.id));

  const layoutEdges = [
    { source: HUMAN_ID, target: hub.id },
    ...workers.map(w => ({ source: hub.id, target: w.id })),
    ...edges.filter(e => e.kind === 'observed' && ids.has(e.source) && ids.has(e.target) && e.source !== e.target)
      .map(e => ({ source: e.source, target: e.target })),
  ];
  const pos = hierarchicalLayout([{ id: HUMAN_ID }, ...profiles.map(p => ({ id: p.id }))], layoutEdges, 1600, 900);

  // Columns in the smart layout (x) become steps here; dense columns are split
  // into sub-columns about 55px apart, so cluster x values within 100px.
  const xs = [...new Set(workers.map(w => Math.round(pos[w.id]?.x ?? 0)))].sort((a, b) => a - b);
  const steps: number[] = [];
  for (const x of xs) if (!steps.length || x - steps[steps.length - 1] > 100) steps.push(x);
  const stepOf = (id: string) => {
    const x = pos[id]?.x ?? 0;
    let best = 0;
    steps.forEach((s, i) => { if (Math.abs(s - x) < Math.abs(steps[best] - x)) best = i; });
    return best;
  };
  const rows: HermesProfile[][] = steps.map(() => []);
  for (const w of workers) rows[stepOf(w.id)].push(w);
  rows.forEach(r => r.sort((a, b) => (pos[a.id]?.y ?? 0) - (pos[b.id]?.y ?? 0)));

  const cols = Math.max(PER_ROW, ...rows.map(r => r.length));
  const width = cols * NODE_W + (cols + 1) * GAP_X;
  const nodes = new Map<string, NodeBox>();
  nodes.set(HUMAN_ID, { id: HUMAN_ID, x: GAP_X, y: TOP_Y });
  nodes.set(hub.id, { id: hub.id, x: (width - NODE_W) / 2, y: TOP_Y });
  const firstRowY = opts.labels ? WORKER_Y_LABELLED : WORKER_Y;
  rows.forEach((row, r) => {
    const rowW = row.length * NODE_W + (row.length - 1) * GAP_X;
    const startX = (width - rowW) / 2;
    row.forEach((p, i) => nodes.set(p.id, { id: p.id, x: startX + i * (NODE_W + GAP_X), y: firstRowY + r * ROW_GAP }));
  });
  const n = rows.length;
  const workerBounds = n ? { x: GAP_X / 2, y: firstRowY - 14, w: width - GAP_X, h: (n - 1) * ROW_GAP + NODE_H + 44 } : null;
  const height = n ? firstRowY + (n - 1) * ROW_GAP + NODE_H + 56 : TOP_Y + NODE_H + 48;
  return { width, height, nodes, workerBounds, firstRowY };
}

/**
 * Connector for a hand-off between two workers on different rows: down from
 * the source, across in the gap under its row, and down into the target
 * (through the column gap when it skips rows). Same shape as treeBranch, so
 * colour and arrowhead work the same way. Returns null for same-row or upward
 * hand-offs; those fall back to a curve.
 */
export function stepConnector(a: NodeBox, b: NodeBox): TreeBranch | null {
  const ax = a.x + NODE_W / 2, bx = b.x + NODE_W / 2;
  const top = a.y + NODE_H;
  if (b.y <= top) return null;
  const midA = top + (ROW_GAP - NODE_H) / 2;
  const end = b.y - 2;
  let pts: Pt[];
  if (b.y - a.y <= ROW_GAP + 1) {
    pts = [[ax, top], [ax, midA], [bx, midA], [bx, end]];
  } else {
    const gx = b.x - GAP_X / 2, lane = b.y - 22;
    pts = [[ax, top], [ax, midA], [gx, midA], [gx, lane], [bx, lane], [bx, end]];
  }
  const [, cy] = pts[pts.length - 2];
  return {
    trunk: '',
    branch: roundedPath(pts),
    drop: `M${bx},${cy + CORNER} L${bx},${end}`,
    label: { x: bx + 8, y: cy + 15 },
  };
}
