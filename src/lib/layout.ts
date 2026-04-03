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

export interface LayoutGroup {
  id: string;
  nodeIds: string[];
  /** Set on subgroups to indicate their parent group id. */
  parentGroupId?: string;
}

export type PositionMap = Record<string, { x: number; y: number; z?: number }>;

// ── Global Node Overlap Resolution ─────────────────────────────────────────────

export function resolveNodeOverlaps(
  positions: PositionMap,
  canvasW: number,
  canvasH: number,
  padX = 80,
  padY = 70
): PositionMap {
  const result = { ...positions };
  const MIN_DIST_X = 120; // 32px glyph radius + ~80px label + horizontal breathing
  const MIN_DIST_Y = 140; // 32px glyph radius + ~100px multi-line label + vertical breathing
  const allIds = Object.keys(result);
  for (let pass = 0; pass < 8; pass++) {
    let moved = false;
    for (let i = 0; i < allIds.length; i++) {
      for (let j = i + 1; j < allIds.length; j++) {
        const a = result[allIds[i]];
        const b = result[allIds[j]];
        if (!a || !b) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;

        // Elliptical distance ratio
        const ratioX = dx / MIN_DIST_X;
        const ratioY = dy / MIN_DIST_Y;
        const distSq = ratioX * ratioX + ratioY * ratioY;

        if (distSq < 1 && distSq > 0) {
          const dist = Math.sqrt(distSq);
          const overlap = 1 - dist;

          // Normalized elliptical push directions point outward
          const nx = ratioX / dist;
          const ny = ratioY / dist;

          // Multiply back by the radii to get actual pixels, then apply the 
          // overlap fraction, plus a tiny structural push to break total symmetry
          const fx = nx * overlap * MIN_DIST_X * 0.30 + (dx === 0 ? 0.1 : 0);
          const fy = ny * overlap * MIN_DIST_Y * 0.70 + (dy === 0 ? 1.0 : 0);

          result[allIds[i]] = {
            ...a,
            x: Math.round(Math.max(padX, a.x - fx)),
            y: Math.round(Math.max(padY, a.y - fy)),
          };
          result[allIds[j]] = {
            ...b,
            x: Math.round(Math.min(canvasW - padX, b.x + fx)),
            y: Math.round(Math.min(canvasH - padY, b.y + fy)),
          };
          moved = true;
        } else if (distSq === 0) {
          // Exactly identical positions — push apart manually
          const fy = MIN_DIST_Y * 0.5;
          result[allIds[i]] = {
            ...a,
            y: Math.round(Math.max(padY, a.y - fy)),
          };
          result[allIds[j]] = {
            ...b,
            y: Math.round(Math.min(canvasH - padY, b.y + fy)),
          };
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
  return result;
}

// ── Group-aware layout ─────────────────────────────────────────────────────────
//
// AABB physics solver (no velocity / no elasticity — pure position assignment).
//
// Ported from the Work-Group Layout Engine demo and adapted for server-side use:
//
//   • HUB GRAVITY    — every group is gently pulled toward the most-connected node
//                      (highest total edge degree), which acts as the layout center.
//   • SHARED TENSION — group pairs that share ≥1 node are pulled toward each other.
//                      Shared-node groups ARE allowed to overlap.
//   • AABB COLLISION — group pairs with no shared nodes are pushed apart along the
//                      axis of least resistance (shortest overlap).  Non-sharing
//                      groups must NEVER visually overlap.
//
// Each force is applied as a direct delta (no accumulated velocity).
// Gravity + tension cool down over iterations via COOLING_RATE.
// Collision is always applied at full strength — guarantees convergence.
//
// Bbox formula mirrors GraphCanvas exactly (PAD=34, SZ=56):
//   rendered left   = min(node.x) − PAD
//   rendered right  = max(node.x) + SZ + PAD
//   rendered top    = min(node.y) − PAD
//   rendered bottom = max(node.y) + SZ + PAD

export function groupAwareLayout(
  positions: PositionMap,
  groups: LayoutGroup[],
  canvasW: number,
  /** Optional edge list — used to identify the hub (most-connected) node. */
  edges?: LayoutEdge[],
): PositionMap {
  const GC_PAD = 34;   // must match GraphCanvas PAD constant
  const GC_SZ = 56;   // must match GraphCanvas node element size
  const SEP_GAP = 32;   // minimum pixel gap between non-sharing group boxes

  // ── Recursively collect all nodeIds for a group (own + all descendants) ──
  const effNodeIds = (groupId: string): string[] => {
    const g = groups.find((g) => g.id === groupId);
    if (!g) return [];
    const children = groups.filter((c) => c.parentGroupId === groupId);
    return [...g.nodeIds, ...children.flatMap((c) => effNodeIds(c.id))];
  };

  // Only top-level groups participate; effective nodeIds include descendants so
  // parent groups with subgroups are not accidentally excluded.
  // A group is also treated as top-level when its parentGroupId references a
  // group that doesn't exist in the list (orphaned subgroup — parent was never
  // defined, e.g. a placeholder "grp_daily_reconciliation" in CSV exports).
  const groupIdSet = new Set(groups.map((g) => g.id));
  const topLevel = groups
    .filter((g) => !g.parentGroupId || !groupIdSet.has(g.parentGroupId))
    .map((g) => ({ g, effIds: effNodeIds(g.id) }))
    .filter(({ effIds }) => effIds.some((id) => positions[id]));

  // ── Identify standalone (lone) nodes not in any group ────────────────────
  const groupedNodeIds = new Set(topLevel.flatMap(g => g.effIds));
  const loneNodeIds = Object.keys(positions).filter(id => !groupedNodeIds.has(id));
  
  // Add lone nodes as "virtual groups" so they benefit from gravity + collision
  loneNodeIds.forEach(id => {
    topLevel.push({
      g: { id, nodeIds: [id] },
      effIds: [id]
    });
  });

  if (topLevel.length < 2) return positions;

  const n = topLevel.length;

  // ── Hub position — gravitational center of the layout ────────────────────
  // The node with the highest total edge degree becomes the center anchor.
  // Groups are gently pulled toward it so the layout clusters naturally.
  // Falls back to the centroid of all positioned nodes when no edges supplied.
  let hubX: number;
  let hubY: number;
  if (edges && edges.length > 0) {
    const deg: Record<string, number> = {};
    for (const e of edges) {
      deg[e.source] = (deg[e.source] ?? 0) + 1;
      deg[e.target] = (deg[e.target] ?? 0) + 1;
    }
    const hubId = Object.keys(positions).sort((a, b) => (deg[b] ?? 0) - (deg[a] ?? 0))[0];
    hubX = positions[hubId]?.x ?? canvasW / 2;
    hubY = positions[hubId]?.y ?? 400;
  } else {
    const allPos = Object.values(positions);
    hubX = allPos.reduce((s, p) => s + p.x, 0) / (allPos.length || 1);
    hubY = allPos.reduce((s, p) => s + p.y, 0) / (allPos.length || 1);
  }

  // Estimate canvas height so Y clamping keeps nodes on-screen.
  // Increased from +150 to +350 to allow more room for AABB overlap resolution.
  const canvasH = Math.max(
    800,
    Math.max(...Object.values(positions).map((p) => p.y)) + 350,
  );

  // ── Working position copy ─────────────────────────────────────────────────
  const result: PositionMap = { ...positions };

  // ── AABB bbox from working copy — mirrors GraphCanvas group rendering ─────
  const getBbox = (effIds: string[]) => {
    const xs = effIds.map((id) => result[id]?.x).filter((x): x is number => x !== undefined);
    const ys = effIds.map((id) => result[id]?.y).filter((y): y is number => y !== undefined);
    if (!xs.length) return null;
    const minX = Math.min(...xs) - GC_PAD;
    const maxX = Math.max(...xs) + GC_SZ + GC_PAD;
    const minY = Math.min(...ys) - GC_PAD;
    const maxY = Math.max(...ys) + GC_SZ + GC_PAD;
    return {
      cx: (minX + maxX) / 2,
      cy: (minY + maxY) / 2,
      hw: (maxX - minX) / 2,  // half-width
      hh: (maxY - minY) / 2,  // half-height
    };
  };

  // Shift every node in effIds by (dx, dy), clamped to canvas bounds.
  const moveGroup = (effIds: string[], mdx: number, mdy: number) => {
    for (const id of effIds) {
      if (!result[id]) continue;
      result[id] = {
        ...result[id],
        x: Math.max(60, Math.min(canvasW - 60, result[id].x + mdx)),
        y: Math.max(40, Math.min(canvasH - 40, result[id].y + mdy)),
      };
    }
  };

  // Pre-compute pairwise sharing once (sharing groups may overlap; non-sharing must not).
  const sharesWith: boolean[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => {
      if (i === j) return false;
      const setJ = new Set(topLevel[j].effIds);
      return topLevel[i].effIds.some((id) => setJ.has(id));
    }),
  );

  // ── Solver constants ──────────────────────────────────────────────────────
  // Gravity is kept very light so it cannot overpower the AABB collision push.
  // (Original 0.04 allowed gravity to pull a group back faster than a small
  // collision correction could push it out, causing persistent overlap.)
  const GRAVITY = 0.012;  // gentle hub pull — must not defeat collision
  const TENSION = 0.08;   // pull sharing groups toward each other (soft)
  const COOLING_RATE = 0.985;  // slightly slower decay for more resolution time
  const ITERATIONS = 400;    // more iterations for better settlement of complex graphs

  let temperature = 1.0;

  for (let iter = 0; iter < ITERATIONS && temperature > 0.004; iter++) {
    const dx = new Float64Array(n);
    const dy = new Float64Array(n);

    // 1. HUB GRAVITY — pull each group centroid toward the most-connected node.
    for (let i = 0; i < n; i++) {
      const box = getBbox(topLevel[i].effIds);
      if (!box) continue;
      dx[i] += (hubX - box.cx) * GRAVITY * temperature;
      dy[i] += (hubY - box.cy) * GRAVITY * temperature;
    }

    // 2. SHARED-NODE TENSION — sharing pairs attract toward their shared midpoint.
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (!sharesWith[i][j]) continue;
        const bI = getBbox(topLevel[i].effIds);
        const bJ = getBbox(topLevel[j].effIds);
        if (!bI || !bJ) continue;
        const midX = (bI.cx + bJ.cx) / 2;
        const midY = (bI.cy + bJ.cy) / 2;
        const t = TENSION * temperature;
        dx[i] += (midX - bI.cx) * t; dy[i] += (midY - bI.cy) * t;
        dx[j] += (midX - bJ.cx) * t; dy[j] += (midY - bJ.cy) * t;
      }
    }

    // 3. SHARING-GROUP CENTROID REPULSION — prevents sharing groups from
    //    completely collapsing when multiple groups share the same node.
    //    Unlike AABB collision (for non-sharing pairs), this runs at full
    //    strength so low-temperature tension can't override it.
    const SHARING_SEP = GC_SZ * 2 + SEP_GAP; // ~128 px min centroid-to-centroid distance
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (!sharesWith[i][j]) continue;
        const bI = getBbox(topLevel[i].effIds);
        const bJ = getBbox(topLevel[j].effIds);
        if (!bI || !bJ) continue;
        const dcx = bI.cx - bJ.cx;
        const dcy = bI.cy - bJ.cy;
        const dist = Math.sqrt(dcx * dcx + dcy * dcy);
        if (dist < SHARING_SEP) {
          // Push along the centroid vector; break ties along X.
          const nx = dist > 0 ? dcx / dist : 1;
          const ny = dist > 0 ? dcy / dist : 0;
          const push = (SHARING_SEP - dist) * 0.3;
          dx[i] += nx * push; dy[i] += ny * push;
          dx[j] -= nx * push; dy[j] -= ny * push;
        }
      }
    }

    // 4. AABB COLLISION — non-sharing overlapping groups are pushed apart.
    //    Full strength every iteration (no temperature scaling) → deterministic.
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (sharesWith[i][j]) continue;          // sharing groups may overlap
        const bA = getBbox(topLevel[i].effIds);
        const bB = getBbox(topLevel[j].effIds);
        if (!bA || !bB) continue;

        const overlapX = bA.hw + bB.hw + SEP_GAP - Math.abs(bA.cx - bB.cx);
        const overlapY = bA.hh + bB.hh + SEP_GAP - Math.abs(bA.cy - bB.cy);

        if (overlapX > 0 && overlapY > 0) {
          // Resolve along the shortest-exit axis (mirrors the demo's AABB logic).
          if (overlapX <= overlapY) {
            const dir = bA.cx <= bB.cx ? -1 : 1;
            dx[i] += dir * overlapX * 0.5;
            dx[j] -= dir * overlapX * 0.5;
          } else {
            const dir = bA.cy <= bB.cy ? -1 : 1;
            dy[i] += dir * overlapY * 0.5;
            dy[j] -= dir * overlapY * 0.5;
          }
        }
      }
    }

    // Apply all accumulated deltas for this iteration.
    for (let i = 0; i < n; i++) {
      if (dx[i] !== 0 || dy[i] !== 0) moveGroup(topLevel[i].effIds, dx[i], dy[i]);
    }

    temperature *= COOLING_RATE;
  }

  // ── Strict final separation: node-level adjustment ────────────────────────
  // Group-level AABB can stall when groups are the same size: equal forces from
  // multiple neighbours cancel out (A pushed left by B, right by C → net 0).
  // This pass breaks the rigid-body constraint: only the nodes on the FACING
  // side of each overlap are moved, so the group's bounding box shrinks toward
  // the violating boundary rather than the whole group translating.
  //
  // • Deltas are accumulated across all pairs before any node is moved.
  // • sortFn returns nodes ordered closest-to-opponent first (facing side).
  // • Only ceil(count/2) facing nodes are pushed, keeping internal layout intact.
  const sortFn = (ids: string[], useX: boolean, descending: boolean) =>
    ids
      .filter(id => result[id])
      .sort((a, b) => {
        const key = useX ? 'x' : 'y';
        return descending
          ? result[b]![key] - result[a]![key]
          : result[a]![key] - result[b]![key];
      });

  for (let pass = 0; pass < 60; pass++) {
    const nodeDx: Record<string, number> = {};
    const nodeDy: Record<string, number> = {};
    let anyMoved = false;

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (sharesWith[i][j]) continue;
        const bA = getBbox(topLevel[i].effIds);
        const bB = getBbox(topLevel[j].effIds);
        if (!bA || !bB) continue;

        const overlapX = bA.hw + bB.hw + SEP_GAP - Math.abs(bA.cx - bB.cx);
        const overlapY = bA.hh + bB.hh + SEP_GAP - Math.abs(bA.cy - bB.cy);
        if (overlapX <= 0 || overlapY <= 0) continue;

        anyMoved = true;
        const useX = overlapX <= overlapY;
        const push = (useX ? overlapX : overlapY) * 0.5;
        // aFirst: true when A's centroid is ≤ B's on the resolution axis
        const aFirst = useX ? bA.cx <= bB.cx : bA.cy <= bB.cy;

        // Facing nodes of A: highest values when A is left/above (aFirst=true),
        // lowest values when A is right/below (aFirst=false).
        const aFacing = sortFn(topLevel[i].effIds, useX, aFirst);
        const aCount = Math.ceil(aFacing.length / 2);
        aFacing.slice(0, aCount).forEach(id => {
          if (useX) nodeDx[id] = (nodeDx[id] ?? 0) + (aFirst ? -push : push);
          else nodeDy[id] = (nodeDy[id] ?? 0) + (aFirst ? -push : push);
        });

        // Facing nodes of B: lowest values when B is right/below (aFirst=true).
        const bFacing = sortFn(topLevel[j].effIds, useX, !aFirst);
        const bCount = Math.ceil(bFacing.length / 2);
        bFacing.slice(0, bCount).forEach(id => {
          if (useX) nodeDx[id] = (nodeDx[id] ?? 0) + (aFirst ? push : -push);
          else nodeDy[id] = (nodeDy[id] ?? 0) + (aFirst ? push : -push);
        });
      }
    }

    if (!anyMoved) break;

    // Apply all accumulated node deltas at once.
    const allIds = new Set([...Object.keys(nodeDx), ...Object.keys(nodeDy)]);
    for (const id of allIds) {
      const pos = result[id];
      if (!pos) continue;
      result[id] = {
        ...pos,
        x: Math.max(60, Math.min(canvasW - 60, pos.x + (nodeDx[id] ?? 0))),
        y: Math.max(40, Math.min(canvasH - 40, pos.y + (nodeDy[id] ?? 0))),
      };
    }
  }

  // ── Node eviction: push non-member nodes outside group bounding boxes ───────
  // A non-member node (e.g. "mary" from HR Evaluation) can sit inside another
  // group's bbox (e.g. Data Ingestion) because the two groups share a node
  // ("jack") that anchors both bboxes nearby.
  //
  // Evicting per-group independently causes oscillation when two non-member
  // groups' bboxes overlap around the node: group A pushes the node down,
  // group B pushes it up, net = 0, stuck.
  //
  // Solution: compute the UNION of all non-member group bboxes that contain
  // the node, then find the shortest exit from that union that fits within
  // canvas bounds. One direction wins, no oscillation.
  const allNodeIds = new Set(topLevel.flatMap((g) => g.effIds));

  for (let evPass = 0; evPass < 40; evPass++) {
    const evDx: Record<string, number> = {};
    const evDy: Record<string, number> = {};
    let evMoved = false;

    for (const nodeId of allNodeIds) {
      const pos = result[nodeId];
      if (!pos) continue;

      // Build union bbox of all non-member groups that contain this node.
      let uLeft = Infinity, uRight = -Infinity;
      let uTop = Infinity, uBottom = -Infinity;

      for (let i = 0; i < n; i++) {
        if (topLevel[i].effIds.includes(nodeId)) continue; // member — skip
        const bbox = getBbox(topLevel[i].effIds);
        if (!bbox) continue;
        const bL = bbox.cx - bbox.hw, bR = bbox.cx + bbox.hw;
        const bT = bbox.cy - bbox.hh, bB = bbox.cy + bbox.hh;
        if (pos.x <= bL || pos.x >= bR || pos.y <= bT || pos.y >= bB) continue;
        // Node is inside this group's bbox — expand union.
        uLeft = Math.min(uLeft, bL);
        uRight = Math.max(uRight, bR);
        uTop = Math.min(uTop, bT);
        uBottom = Math.max(uBottom, bB);
      }

      if (uLeft === Infinity) continue; // not inside any non-member group

      evMoved = true;

      // Exit distances to each side of the union bbox (with SEP_GAP clearance).
      const dL = pos.x - uLeft + SEP_GAP;   // push LEFT  → new x = uLeft  - SEP_GAP
      const dR = uRight - pos.x + SEP_GAP;  // push RIGHT → new x = uRight + SEP_GAP
      const dT = pos.y - uTop + SEP_GAP;   // push UP    → new y = uTop   - SEP_GAP
      const dB = uBottom - pos.y + SEP_GAP;  // push DOWN  → new y = uBottom+ SEP_GAP

      // Only consider exits that land within canvas bounds.
      type Exit = { axis: 'x' | 'y'; delta: number; dist: number };
      const exits: Exit[] = [];
      if (pos.x - dL >= 60) exits.push({ axis: 'x', delta: -dL, dist: dL });
      if (pos.x + dR <= canvasW - 60) exits.push({ axis: 'x', delta: dR, dist: dR });
      if (pos.y - dT >= 40) exits.push({ axis: 'y', delta: -dT, dist: dT });
      if (pos.y + dB <= canvasH - 40) exits.push({ axis: 'y', delta: dB, dist: dB });

      if (exits.length === 0) continue; // surrounded — cannot escape, leave it

      const best = exits.reduce((a, b) => a.dist <= b.dist ? a : b);
      if (best.axis === 'x') evDx[nodeId] = (evDx[nodeId] ?? 0) + best.delta;
      else evDy[nodeId] = (evDy[nodeId] ?? 0) + best.delta;
    }

    if (!evMoved) break;
    for (const id of new Set([...Object.keys(evDx), ...Object.keys(evDy)])) {
      const pos = result[id];
      if (!pos) continue;
      result[id] = {
        ...pos,
        x: Math.max(60, Math.min(canvasW - 60, pos.x + (evDx[id] ?? 0))),
        y: Math.max(40, Math.min(canvasH - 40, pos.y + (evDy[id] ?? 0))),
      };
    }
  }

  // Final guarantee: multi-group nodes like Jack might have been squished back
  // into single-group nodes like Bloomberg. Resolve node-level overlaps.
  return resolveNodeOverlaps(result, canvasW, canvasH, 60, 40);
}

// ── Cycle breaker ─────────────────────────────────────────────────────────────
//
// Kahn's BFS (used by hierarchicalLayout) produces garbage positions when the
// edge list contains cycles: all cycle-participants end up with in-degree > 0
// and get dumped into sequential "overflow" layers instead of their proper
// pipeline positions.
//
// This helper runs a DFS and tags every back-edge (an edge that points back to a
// GRAY ancestor — i.e., creates a cycle) so the caller can exclude them before
// running the layering algorithm.  The actual edges are still drawn on screen;
// we only exclude back-edges from the POSITION calculation.

function detectBackEdges(nodes: LayoutNode[], edges: LayoutEdge[]): Set<string> {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color: Record<string, number> = {};
  const adj: Record<string, string[]> = {};

  for (const n of nodes) { color[n.id] = WHITE; adj[n.id] = []; }
  for (const e of edges) {
    if (adj[e.source] !== undefined) adj[e.source].push(e.target);
  }

  const back = new Set<string>();

  // Iterative DFS to avoid call-stack overflow on large graphs.
  for (const start of nodes) {
    if (color[start.id] !== WHITE) continue;
    // Stack entry: [nodeId, index into adj[nodeId]]
    const stack: [string, number][] = [[start.id, 0]];
    color[start.id] = GRAY;

    while (stack.length) {
      const top = stack[stack.length - 1];
      const [u, i] = top;
      const neighbours = adj[u];

      if (i >= neighbours.length) {
        color[u] = BLACK;
        stack.pop();
      } else {
        top[1]++;          // advance neighbour index
        const v = neighbours[i];
        if (color[v] === GRAY) {
          back.add(`${u}→${v}`);   // back-edge
        } else if (color[v] === WHITE) {
          color[v] = GRAY;
          stack.push([v, 0]);
        }
      }
    }
  }

  return back;
}

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
          const force = overlap * 0.25 * cooling;
          const sign = diff >= 0 ? 1 : -1;
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

  // ── Break cycles before layer assignment ────────────────────────────────
  // Kahn's BFS produces degenerate positions when cycles exist: every node
  // in the cycle keeps inDegree > 0 and ends up dumped into "overflow" layers
  // at the far right of the canvas.  We detect back-edges via iterative DFS
  // and exclude them from the layering / predecessor maps.  The actual edges
  // are still rendered on screen — only the POSITION calculation ignores them.
  const _backEdges = detectBackEdges(nodes, edges);
  const layoutEdges = _backEdges.size > 0
    ? edges.filter((e) => !_backEdges.has(`${e.source}→${e.target}`))
    : edges;

  // ── Spacing constants ────────────────────────────────────────────────────
  const padX = 80;
  const padY = 70;
  const usableW = canvasW - padX * 2;
  const usableH = canvasH - padY * 2;
  /** Minimum horizontal gap between layer x-centres (columns). */
  const MIN_LAYER_SPACING_X = 150;
  /** Maximum horizontal gap — prevents sparse graphs (2 real layers in a wide
   *  canvas) from stretching nodes across the whole viewport. */
  const MAX_LAYER_SPACING_X = 230;
  /** Minimum vertical gap between node centres in the same column. */
  const MIN_NODE_SPACING_Y = 110;
  /** Split dense columns into two sub-columns when count exceeds this. */
  const MAX_PER_COL = 4;
  /** X offset between the two sub-columns for dense layers. */
  const COL_OFFSET_PX = 55;

  // ── Build predecessor / successor maps ──────────────────────────────────
  const successors: Record<string, Set<string>> = {};
  const predecessors: Record<string, Set<string>> = {};
  for (const id of ids) {
    successors[id] = new Set();
    predecessors[id] = new Set();
  }
  for (const e of layoutEdges) {
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
  const numLayers = maxLayer + 1;
  const naturalSpacingX = numLayers > 1 ? usableW / (numLayers - 1) : 0;
  const layerSpacingX = Math.min(MAX_LAYER_SPACING_X, Math.max(MIN_LAYER_SPACING_X, naturalSpacingX));

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
    const count = layerNodes.length;

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
      const leftNodes = layerNodes.filter((_, i) => i % 2 === 0);
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
        const span = Math.max(usableH, (n - 1) * MIN_NODE_SPACING_Y);
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
      placeCol(leftNodes, -COL_OFFSET_PX);
      placeCol(rightNodes, COL_OFFSET_PX);

    } else if (count === 1) {
      // ── Single node: inherit anchor Y + lane stagger for visual depth ────
      // Alternating layers shift ±STAGGER so single-node chains zigzag
      // vertically rather than sitting on a perfectly flat horizontal line.
      const STAGGER = numLayers > 3 ? 50 : 0;
      const laneShift = (l % 2 === 0 ? 1 : -1) * STAGGER;
      const id = layerNodes[0];
      const jitter = idToJitter(id, 0.2);
      positions[id] = {
        x: Math.round(x),
        y: Math.round(Math.max(padY, Math.min(canvasH - padY, anchorY + laneShift))),
        z: Math.max(-1, Math.min(1, baseZ + jitter)),
      };

    } else {
      // ── Normal column: spread nodes evenly, centred on anchorY ──────────
      const span = Math.max(usableH * 0.6, (count - 1) * MIN_NODE_SPACING_Y);
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
    const id = layers[l][0];
    const succY = avgPlacedY(successors[id]);
    if (succY === null) continue;
    const predY = avgPlacedY(predecessors[id]);
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
          const gap = (positions[curr]?.y ?? 0) - (positions[prev]?.y ?? 0);
          if (gap < MIN_NODE_SPACING_Y) {
            const push = (MIN_NODE_SPACING_Y - gap) / 2;
            if (positions[prev]) positions[prev] = { ...positions[prev], y: Math.round(Math.max(padY, positions[prev].y - push)) };
            if (positions[curr]) positions[curr] = { ...positions[curr], y: Math.round(Math.min(canvasH - padY, positions[curr].y + push)) };
          }
        }
      }
    }
  }

  // ── Global pairwise overlap resolution ────────────────────────────────────
  // Catches nodes that ended up too close across adjacent layers, and uses the
  // shared elliptical check helper to account for node label room.
  return resolveNodeOverlaps(positions, canvasW, canvasH, padX, padY);
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
  const degree: Record<string, number> = {};
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
      const angle = resolved[i];
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
  const pad = 80;

  // Ideal spring length
  const area = (canvasW - pad * 2) * (canvasH - pad * 2);
  const k = Math.sqrt(area / count);

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
  const iterations = 200;
  let temperature = Math.min(canvasW, canvasH) * 0.1;
  const cooling = temperature / (iterations + 1);

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
      const d = disp[n.id];
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
