/**
 * layout.ts — Smart graph layout algorithms for workflow visualisation.
 *
 * Two algorithms are exported:
 *   • hierarchicalLayout  — Sugiyama-style layered layout (great for process maps /
 *                           directed pipelines with a clear start → end flow).
 *   • forceDirectedLayout — Fruchterman-Reingold force-directed layout (great for
 *                           ecosystem / network graphs without strict directionality).
 *
 * Both functions accept the same minimal node/edge shape used by the AI parse-workflow
 * route and return a `Record<id, {x, y}>` position map.
 */

// ── Shared types ───────────────────────────────────────────────────────────────

export interface LayoutNode {
  id: string;
}

export interface LayoutEdge {
  source: string;
  target: string;
}

export type PositionMap = Record<string, { x: number; y: number; z?: number }>;

// ── Shared helpers ─────────────────────────────────────────────────────────────

/**
 * Deterministic per-id jitter in the range [-scale/2, +scale/2].
 * Uses a simple djb2-style hash so the same id always produces the same value.
 */
function idToJitter(id: string, scale: number): number {
  let h = 5381;
  for (const c of id) h = ((h << 5) + h) ^ c.charCodeAt(0);
  return ((h >>> 0) % 1000) / 1000 * scale - scale / 2;
}

/**
 * Concentric Force Rings — intra-ring angular repulsion pass.
 *
 * When a ring has many nodes the equal-spacing formula produces crowded /
 * overlapping labels.  This short 1-D force simulation works purely in angular
 * space: each node repels its ring-neighbours until the minimum arc-gap
 * (≈ node diameter + 40 % breathing room) is respected.
 *
 * Sparse rings (≤ 4 nodes) skip this pass entirely — their even spacing is
 * already correct and applying forces would shift the familiar 4-node layout
 * unnecessarily.
 *
 * @param initialAngles  Starting angles in radians (one per node).
 * @param nodeGlyphPx    Approximate pixel radius of one rendered node circle.
 * @param ringR          Ring radius in canvas pixels.
 * @param iterations     Simulation steps (default 80 gives good convergence).
 */
function resolveRingAngles(
  initialAngles: number[],
  nodeGlyphPx: number,
  ringR: number,
  iterations = 80,
): number[] {
  const n = initialAngles.length;
  if (n <= 1) return initialAngles;

  // Minimum angular gap so glyph circles don't touch (+40 % breathing room).
  // Capped at full circle / n so nodes can't wrap past each other.
  const minArcLen = nodeGlyphPx * 2 * 1.4;
  const minAngGap = ringR > 0
    ? Math.min(minArcLen / ringR, (2 * Math.PI) / n)
    : (2 * Math.PI) / n;

  let a = [...initialAngles];

  for (let step = 0; step < iterations; step++) {
    const forces = new Array<number>(n).fill(0);
    const cooling = 1 - step / iterations;

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        // Angular difference normalised to (−π, π]
        let diff = a[j] - a[i];
        // Normalise to (-π, π] in O(1) via modulo instead of a while-loop
        diff = ((diff + Math.PI) % (2 * Math.PI) + (2 * Math.PI)) % (2 * Math.PI) - Math.PI;

        const absDiff = Math.abs(diff);
        if (absDiff < minAngGap * 2) {
          // Soft-spring repulsion proportional to overlap, cooled by temperature
          const overlap = minAngGap - absDiff / 2;
          const force   = overlap * 0.25 * cooling;
          const sign    = diff >= 0 ? 1 : -1;
          forces[i] -= sign * force;
          forces[j] += sign * force;
        }
      }
    }

    // Cap displacement by a temperature that shrinks with iterations
    const maxStep = 0.05 * cooling;
    a = a.map((angle, i) =>
      angle + Math.sign(forces[i]) * Math.min(Math.abs(forces[i]), maxStep),
    );
  }

  return a;
}

// ── 1. Hierarchical layout — horizontal flow (left → right) ───────────────────
//
// Layers flow LEFT → RIGHT (X = layer depth).  Nodes within a layer spread
// VERTICALLY (Y), centred around the average Y of their predecessors so that
// edges stay short and children cluster near their parents.
//
// Algorithm:
//   1. Kahn's BFS assigns each node a "layer" (0 = roots, grows rightward).
//   2. Barycenter ordering within each layer minimises vertical edge crossings.
//   3. Top-down placement: each column's nodes are centred around the mean Y
//      of their predecessors.  Single-node columns inherit predecessor Y exactly.
//   4. Bottom-up refinement: single-node columns blend pred / succ Y averages.
//   5. Vertical overlap resolution: push nodes apart until ≥ MIN_NODE_SPACING_Y.

export function hierarchicalLayout(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  canvasW = 900,
  canvasH = 600,
): PositionMap {
  if (nodes.length === 0) return {};
  if (nodes.length === 1) return { [nodes[0].id]: { x: canvasW / 2, y: canvasH / 2 } };

  const ids = nodes.map((n) => n.id);

  // ── Spacing constants ────────────────────────────────────────────────────
  const padX = 80;
  const padY = 70;
  const usableW = canvasW - padX * 2;
  const usableH = canvasH - padY * 2;
  /** Minimum horizontal gap between layer x-centres (columns). */
  const MIN_LAYER_SPACING_X = 150;
  /** Minimum vertical gap between node centres in the same column. */
  const MIN_NODE_SPACING_Y  = 110;
  /** Split dense columns into two sub-columns when count exceeds this. */
  const MAX_PER_COL   = 4;
  /** X offset between the two sub-columns for dense layers. */
  const COL_OFFSET_PX = 55;

  // ── Build predecessor / successor maps ──────────────────────────────────
  const successors: Record<string, Set<string>>   = {};
  const predecessors: Record<string, Set<string>> = {};
  for (const id of ids) {
    successors[id]   = new Set();
    predecessors[id] = new Set();
  }
  for (const e of edges) {
    if (successors[e.source] && predecessors[e.target]) {
      successors[e.source].add(e.target);
      predecessors[e.target].add(e.source);
    }
  }

  // ── Kahn's BFS — assign layers ──────────────────────────────────────────
  const inDegree: Record<string, number> = {};
  for (const id of ids) inDegree[id] = predecessors[id].size;

  const layer: Record<string, number> = {};
  const queue: string[] = ids.filter((id) => inDegree[id] === 0);
  for (const id of queue) layer[id] = 0;

  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    for (const succ of successors[cur]) {
      inDegree[succ]--;
      layer[succ] = Math.max(layer[succ] ?? 0, (layer[cur] ?? 0) + 1);
      if (inDegree[succ] === 0) queue.push(succ);
    }
  }

  // Cycle / disconnected nodes → extra layer at the end
  let maxLayer = Object.values(layer).reduce((m, l) => Math.max(m, l), 0);
  for (const id of ids) {
    if (layer[id] === undefined) layer[id] = ++maxLayer;
  }
  maxLayer = Object.values(layer).reduce((m, l) => Math.max(m, l), 0);

  // Group nodes by layer
  const layers: string[][] = Array.from({ length: maxLayer + 1 }, () => []);
  for (const id of ids) layers[layer[id]].push(id);

  // Barycenter ordering within each layer — minimises vertical edge crossings
  for (let l = 1; l <= maxLayer; l++) {
    const bary = (id: string): number => {
      const preds = [...predecessors[id]].filter((p) => layer[p] === l - 1);
      if (preds.length === 0) return Infinity;
      return preds.reduce((s, p) => s + layers[l - 1].indexOf(p), 0) / preds.length;
    };
    layers[l].sort((a, b) => bary(a) - bary(b));
  }

  // ── Horizontal column spacing ────────────────────────────────────────────
  const numLayers     = maxLayer + 1;
  const naturalSpacingX = numLayers > 1 ? usableW / (numLayers - 1) : 0;
  const layerSpacingX   = Math.max(MIN_LAYER_SPACING_X, naturalSpacingX);

  // ── Y-position helper: average of already-placed neighbour positions ─────
  const positions: PositionMap = {};

  function avgPlacedY(nodeIds: Iterable<string>): number | null {
    const ys = [...nodeIds]
      .map((id) => positions[id]?.y)
      .filter((y) => y !== undefined) as number[];
    return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : null;
  }

  // ── Top-down placement pass ──────────────────────────────────────────────
  for (let l = 0; l <= maxLayer; l++) {
    const layerNodes = layers[l];
    const count      = layerNodes.length;

    // Column X (may exceed canvasW for many layers — user can pan)
    const x = numLayers === 1 ? canvasW / 2 : padX + l * layerSpacingX;

    // z: leftmost column at front, rightmost at back (for 3-D eco view)
    const baseZ = Math.cos((l / Math.max(maxLayer, 1)) * Math.PI * 0.5) * 0.5;

    // Compute the "anchor" Y for this column: average of all predecessor Y's
    const predYs: number[] = [];
    for (const id of layerNodes) {
      const py = avgPlacedY(predecessors[id]);
      if (py !== null) predYs.push(py);
    }
    const anchorY = predYs.length > 0
      ? predYs.reduce((a, b) => a + b, 0) / predYs.length
      : canvasH / 2;

    if (count > MAX_PER_COL) {
      // ── Dense column: split into two sub-columns (left / right of x) ────
      const leftNodes  = layerNodes.filter((_, i) => i % 2 === 0);
      const rightNodes = layerNodes.filter((_, i) => i % 2 === 1);

      const placeCol = (colNodes: string[], xOff: number) => {
        const n = colNodes.length;
        // Compute per-sub-column anchor
        const colPredYs = colNodes
          .map((id) => avgPlacedY(predecessors[id]))
          .filter((y) => y !== null) as number[];
        const colAnchor = colPredYs.length > 0
          ? colPredYs.reduce((a, b) => a + b, 0) / colPredYs.length
          : canvasH / 2;
        const span   = Math.max(usableH, (n - 1) * MIN_NODE_SPACING_Y);
        const yStart = Math.max(padY, Math.min(canvasH - padY - span, colAnchor - span / 2));
        colNodes.forEach((id, i) => {
          const y = n === 1 ? colAnchor : yStart + i * (span / (n - 1));
          const jitter = idToJitter(id, 0.2);
          positions[id] = {
            x: Math.round(x + xOff),
            y: Math.round(Math.max(padY, Math.min(canvasH - padY, y))),
            z: Math.max(-1, Math.min(1, baseZ + jitter)),
          };
        });
      };
      placeCol(leftNodes,  -COL_OFFSET_PX);
      placeCol(rightNodes,  COL_OFFSET_PX);

    } else if (count === 1) {
      // ── Single node: inherit anchor Y from predecessors ──────────────────
      const id = layerNodes[0];
      const jitter = idToJitter(id, 0.2);
      positions[id] = {
        x: Math.round(x),
        y: Math.round(Math.max(padY, Math.min(canvasH - padY, anchorY))),
        z: Math.max(-1, Math.min(1, baseZ + jitter)),
      };

    } else {
      // ── Normal column: spread nodes evenly, centred on anchorY ──────────
      const span   = Math.max(usableH * 0.6, (count - 1) * MIN_NODE_SPACING_Y);
      const yStart = Math.max(padY, Math.min(canvasH - padY - span, anchorY - span / 2));
      for (let i = 0; i < count; i++) {
        const y = count === 1 ? anchorY : yStart + i * (span / (count - 1));
        const jitter = idToJitter(layerNodes[i], 0.2);
        positions[layerNodes[i]] = {
          x: Math.round(x),
          y: Math.round(y),
          z: Math.max(-1, Math.min(1, baseZ + jitter)),
        };
      }
    }
  }

  // ── Bottom-up refinement for single-node columns ─────────────────────────
  // Blend predecessor Y with successor Y so nodes sit midway along their edge.
  for (let l = maxLayer - 1; l >= 0; l--) {
    if (layers[l].length !== 1) continue;
    const id   = layers[l][0];
    const succY = avgPlacedY(successors[id]);
    if (succY === null) continue;
    const predY  = avgPlacedY(predecessors[id]);
    const blendY = predY !== null ? (predY + succY) / 2 : succY;
    const clamped = Math.max(padY, Math.min(canvasH - padY, blendY));
    positions[id] = { ...positions[id], y: Math.round(clamped) };
  }

  // ── Vertical overlap resolution ──────────────────────────────────────────
  // Within each column (grouped by X bucket), push nodes apart vertically
  // until they are at least MIN_NODE_SPACING_Y apart.  3 passes converge fast.
  for (let l = 0; l <= maxLayer; l++) {
    const byXBucket = new Map<number, string[]>();
    for (const id of layers[l]) {
      const bucket = Math.round((positions[id]?.x ?? 0) / 10) * 10;
      if (!byXBucket.has(bucket)) byXBucket.set(bucket, []);
      byXBucket.get(bucket)!.push(id);
    }
    for (const [, colNodes] of byXBucket) {
      if (colNodes.length < 2) continue;
      for (let pass = 0; pass < 3; pass++) {
        colNodes.sort((a, b) => (positions[a]?.y ?? 0) - (positions[b]?.y ?? 0));
        for (let i = 1; i < colNodes.length; i++) {
          const prev = colNodes[i - 1];
          const curr = colNodes[i];
          const gap  = (positions[curr]?.y ?? 0) - (positions[prev]?.y ?? 0);
          if (gap < MIN_NODE_SPACING_Y) {
            const push = (MIN_NODE_SPACING_Y - gap) / 2;
            if (positions[prev]) positions[prev] = { ...positions[prev], y: Math.round(Math.max(padY,            positions[prev].y - push)) };
            if (positions[curr]) positions[curr] = { ...positions[curr], y: Math.round(Math.min(canvasH - padY, positions[curr].y + push)) };
          }
        }
      }
    }
  }

  return positions;
}

// ── 2. Radial web layout ───────────────────────────────────────────────────────
//
// Algorithm overview:
//   "Miro-fish" / 3-D web-map style: finds the most-connected node and places it
//   at the canvas centre.  All other nodes are arranged in concentric rings via a
//   BFS from that centre node.  Within each ring, nodes are sorted by the average
//   angular position of their parents (barycenter) to minimise edge crossings, and
//   a small per-ring angular rotation adds an organic, non-symmetric feel.
//
//   Result: hubs feel central, leaf nodes radiate outward — similar to Miro's
//   network / mind-map board layout.

export function radialWebLayout(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  canvasW = 960,
  canvasH = 600,
): PositionMap {
  if (nodes.length === 0) return {};
  if (nodes.length === 1) return { [nodes[0].id]: { x: canvasW / 2, y: canvasH / 2 } };

  const ids = nodes.map((n) => n.id);

  // Build undirected degree + neighbour map
  const degree:    Record<string, number>      = {};
  const neighbors: Record<string, Set<string>> = {};
  for (const id of ids) { degree[id] = 0; neighbors[id] = new Set(); }
  for (const e of edges) {
    if (degree[e.source] !== undefined && degree[e.target] !== undefined) {
      degree[e.source]++;
      degree[e.target]++;
      neighbors[e.source].add(e.target);
      neighbors[e.target].add(e.source);
    }
  }

  // Centre = highest-degree node (tie-break: first in list)
  const center = ids.reduce((best, id) => degree[id] > degree[best] ? id : best, ids[0]);

  // BFS from centre to assign rings
  const ring: Record<string, number> = { [center]: 0 };
  const queue = [center];
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    for (const nb of neighbors[cur]) {
      if (ring[nb] === undefined) {
        ring[nb] = ring[cur] + 1;
        queue.push(nb);
      }
    }
  }
  // Disconnected nodes → one extra ring beyond max
  const maxRingBfs = Object.values(ring).reduce((m, r) => Math.max(m, r), 0);
  for (const id of ids) {
    if (ring[id] === undefined) ring[id] = maxRingBfs + 1;
  }
  const maxRing = Object.values(ring).reduce((m, r) => Math.max(m, r), 0);

  // Group nodes by ring
  const rings: string[][] = Array.from({ length: maxRing + 1 }, () => []);
  for (const id of ids) rings[ring[id]].push(id);

  // Radii scale to fit canvas — ring 0 is the centre point, outermost ring fits
  const cx = canvasW / 2;
  const cy = canvasH / 2;
  const pad = 50;
  const maxRadius = (Math.min(canvasW / 2, canvasH / 2) - pad) * 0.78;
  const ringRadius = (r: number): number =>
    r === 0 ? 0 : r === 1
      ? (1 / Math.max(maxRing, 1)) * maxRadius * 0.55   // ring 1 closer to center
      : (r / Math.max(maxRing, 1)) * maxRadius;

  const positions: PositionMap = {};

  for (let r = 0; r <= maxRing; r++) {
    const ringNodes = rings[r];
    if (!ringNodes.length) continue;
    const radius = ringRadius(r);

    if (r === 0) {
      positions[ringNodes[0]] = { x: Math.round(cx), y: Math.round(cy), z: 0.0 };
      continue;
    }

    // Sort this ring's nodes by their parents' average angle (barycenter ordering)
    const prevRingAngleOf: Record<string, number> = {};
    rings[r - 1].forEach((id, i) => {
      prevRingAngleOf[id] = (2 * Math.PI * i) / rings[r - 1].length;
    });
    ringNodes.sort((a, b) => {
      const aParents = [...neighbors[a]].filter((n) => ring[n] === r - 1);
      const bParents = [...neighbors[b]].filter((n) => ring[n] === r - 1);
      const avg = (arr: string[]) =>
        arr.length === 0 ? Infinity : arr.reduce((s, p) => s + (prevRingAngleOf[p] ?? 0), 0) / arr.length;
      return avg(aParents) - avg(bParents);
    });

    const count = ringNodes.length;
    // Slight angular offset per ring for an organic, non-symmetric look
    const startAngle = -Math.PI / 2 + r * 0.4;

    // z: sphere projection — ring 0 (center) at front, outermost ring at back
    const phi = (r / Math.max(maxRing, 1)) * Math.PI; // 0 at center → π at outermost ring
    const baseZ = Math.cos(phi);                        // 1.0 at center, -1.0 at outermost

    // Initial angles: even spacing + small deterministic per-node jitter
    const initialAngles = ringNodes.map((id, i) =>
      startAngle + (2 * Math.PI * i) / count + idToJitter(id, 0.18),
    );

    // Concentric Force Rings: resolve angular overlaps for crowded rings.
    // Threshold > 4 keeps the familiar sparse-graph layout unchanged.
    const NODE_GLYPH_PX = 14; // approximate rendered radius of an eco-sphere (px)
    const resolved = count > 4
      ? resolveRingAngles(initialAngles, NODE_GLYPH_PX, radius)
      : initialAngles;

    for (let i = 0; i < count; i++) {
      const nodeId = ringNodes[i];
      const angle  = resolved[i];
      const zJitter = idToJitter(nodeId, 0.24);
      const z = Math.max(-1, Math.min(1, baseZ + zJitter));
      positions[nodeId] = {
        x: Math.round(cx + radius * Math.cos(angle)),
        y: Math.round(cy + radius * Math.sin(angle)),
        z,
      };
    }
  }

  return positions;
}

// ── 3. Force-directed (Fruchterman-Reingold) layout ───────────────────────────
//
// Algorithm overview:
//   1. Initialise nodes on a circle so they are well-separated from the start.
//   2. Iterate for a fixed number of steps:
//      a. Repulsion: every pair of nodes pushes each other apart  (∝ k²/d).
//      b. Attraction: every edge pulls its two endpoints together (∝ d²/k).
//      c. Apply a displacement capped by a "temperature" that cools each step.
//      d. Clamp positions inside the canvas bounds.
//   3. Return the final positions.

export function forceDirectedLayout(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  canvasW = 900,
  canvasH = 600,
): PositionMap {
  if (nodes.length === 0) return {};
  if (nodes.length === 1) return { [nodes[0].id]: { x: canvasW / 2, y: canvasH / 2 } };

  const count = nodes.length;
  const pad   = 80;

  // Ideal spring length
  const area = (canvasW - pad * 2) * (canvasH - pad * 2);
  const k    = Math.sqrt(area / count);

  // Initialise on a circle
  const pos: Record<string, { x: number; y: number }> = {};
  const cx = canvasW / 2;
  const cy = canvasH / 2;
  const initR = Math.min(canvasW, canvasH) * 0.35;

  nodes.forEach((n, i) => {
    const angle = (2 * Math.PI * i) / count - Math.PI / 2;
    pos[n.id] = {
      x: cx + initR * Math.cos(angle),
      y: cy + initR * Math.sin(angle),
    };
  });

  // Temperature schedule
  const iterations    = 200;
  let temperature     = Math.min(canvasW, canvasH) * 0.1;
  const cooling       = temperature / (iterations + 1);

  for (let iter = 0; iter < iterations; iter++) {
    const disp: Record<string, { dx: number; dy: number }> = {};
    for (const n of nodes) disp[n.id] = { dx: 0, dy: 0 };

    // Repulsion between all pairs
    for (let i = 0; i < count; i++) {
      for (let j = i + 1; j < count; j++) {
        const u = nodes[i].id;
        const v = nodes[j].id;
        const dx = pos[u].x - pos[v].x;
        const dy = pos[u].y - pos[v].y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 0.01);
        const force = (k * k) / dist;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        disp[u].dx += fx;
        disp[u].dy += fy;
        disp[v].dx -= fx;
        disp[v].dy -= fy;
      }
    }

    // Attraction along edges
    for (const e of edges) {
      const u = e.source;
      const v = e.target;
      if (!pos[u] || !pos[v]) continue;
      const dx = pos[u].x - pos[v].x;
      const dy = pos[u].y - pos[v].y;
      const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 0.01);
      const force = (dist * dist) / k;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      disp[u].dx -= fx;
      disp[u].dy -= fy;
      disp[v].dx += fx;
      disp[v].dy += fy;
    }

    // Apply displacement with temperature cap and boundary clamp
    for (const n of nodes) {
      const d  = disp[n.id];
      const mag = Math.sqrt(d.dx * d.dx + d.dy * d.dy);
      if (mag === 0) continue;
      const scale = Math.min(mag, temperature) / mag;
      pos[n.id].x = Math.min(canvasW - pad, Math.max(pad, pos[n.id].x + d.dx * scale));
      pos[n.id].y = Math.min(canvasH - pad, Math.max(pad, pos[n.id].y + d.dy * scale));
    }

    temperature -= cooling;
  }

  // Build degree map for z assignment
  const degree: Record<string, number> = {};
  for (const n of nodes) degree[n.id] = 0;
  for (const e of edges) {
    if (degree[e.source] !== undefined) degree[e.source]++;
    if (degree[e.target] !== undefined) degree[e.target]++;
  }

  const maxDeg = Math.max(...Object.values(degree), 1);

  // Round to integers and assign z based on degree centrality:
  // high-degree nodes are "closer" to viewer (z near 0/front), leaf nodes near ±1
  const result: PositionMap = {};
  for (const n of nodes) {
    const normalizedDeg = degree[n.id] / maxDeg;
    // nodes with more connections are closer to viewer (higher z)
    const baseZ = normalizedDeg * 0.8; // 0.0 to 0.8
    const jitter = idToJitter(n.id, 0.2); // ±0.1
    const z = Math.max(-1, Math.min(1, baseZ + jitter));
    result[n.id] = { x: Math.round(pos[n.id].x), y: Math.round(pos[n.id].y), z };
  }
  return result;
}
