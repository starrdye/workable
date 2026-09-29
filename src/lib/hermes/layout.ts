/**
 * hermes/layout.ts — Fixed hub-and-spoke layout for the team canvas.
 *
 * You and the orchestrator sit on the top row; workers wrap in rows of four
 * underneath. Deterministic on purpose, so nodes never jump between polls.
 */

import type { HermesEdge, HermesProfile } from './types';
import { HUMAN_ID } from './metrics';

export const NODE_W = 200;
export const NODE_H = 92;
const GAP_X = 44;
const TOP_Y = 36;
const WORKER_Y = 250;
const ROW_GAP = 150;
const PER_ROW = 4;

export interface NodeBox { id: string; x: number; y: number }

export interface TeamLayout {
  width: number;
  height: number;
  nodes: Map<string, NodeBox>;
  /** Bounding box of the worker rows, for the board / project boundary. */
  workerBounds: { x: number; y: number; w: number; h: number } | null;
}

export function layoutTeam(profiles: HermesProfile[]): TeamLayout {
  const hub = profiles.find(p => p.isDefault) ?? null;
  const workers = profiles.filter(p => p !== hub);
  const cols = PER_ROW; // fixed width leaves room for the You → orchestrator label
  const width = cols * NODE_W + (cols + 1) * GAP_X;
  const nodes = new Map<string, NodeBox>();

  if (hub) {
    nodes.set(HUMAN_ID, { id: HUMAN_ID, x: GAP_X, y: TOP_Y });
    nodes.set(hub.id, { id: hub.id, x: (width - NODE_W) / 2, y: TOP_Y });
  }

  const firstRowY = hub ? WORKER_Y : TOP_Y;
  const rows = Math.ceil(workers.length / PER_ROW);
  for (let r = 0; r < rows; r++) {
    const row = workers.slice(r * PER_ROW, (r + 1) * PER_ROW);
    const rowW = row.length * NODE_W + (row.length - 1) * GAP_X;
    const startX = (width - rowW) / 2;
    row.forEach((p, i) => nodes.set(p.id, { id: p.id, x: startX + i * (NODE_W + GAP_X), y: firstRowY + r * ROW_GAP }));
  }

  const workerBounds = rows
    ? { x: GAP_X / 2, y: firstRowY - 34, w: width - GAP_X, h: (rows - 1) * ROW_GAP + NODE_H + 58 }
    : null;
  const height = rows ? firstRowY + (rows - 1) * ROW_GAP + NODE_H + 48 : TOP_Y + NODE_H + 48;
  return { width, height, nodes, workerBounds };
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
export function treeBranch(hub: NodeBox, w: NodeBox): TreeBranch {
  const hx = hub.x + NODE_W / 2, hy = hub.y + NODE_H;
  const firstRowY = WORKER_Y;
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
  const [cx, cy] = pts[pts.length - 2];
  const dir = Math.sign(wx - cx);
  // Include the last corner in the coloured drop so the colour starts on the turn.
  const drop = dir === 0 ? `M${wx},${cy} L${wx},${w.y}` : roundedPath([[wx - dir * CORNER * 1.5, cy], [wx, cy], [wx, w.y]]);
  return { trunk, branch: roundedPath(pts), drop, label: { x: wx + 8, y: cy + (w.y - cy) / 2 + 4 } };
}

/** Find the drawn edge for a hand-off, and whether the pulse runs against the arrow. */
export function findEdgeFor(edges: HermesEdge[], from: string, to: string): { edge: HermesEdge; reverse: boolean } | null {
  const fwd = edges.find(e => e.source === from && e.target === to);
  if (fwd) return { edge: fwd, reverse: false };
  const rev = edges.find(e => e.source === to && e.target === from);
  return rev ? { edge: rev, reverse: true } : null;
}
