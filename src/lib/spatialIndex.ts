/**
 * spatialIndex.ts — R-tree spatial index for viewport-based culling.
 * Phase 5: Infinite canvas & viewport streaming.
 *
 * Wraps rbush to provide fast spatial lookups: "which nodes are visible in
 * the current viewport?" This keeps DOM element count under ~200 regardless
 * of total graph size, enabling smooth pan/zoom at 10,000+ nodes.
 */

import RBush from 'rbush';
import type { NodePosition } from './serverState';

// ── Types ────────────────────────────────────────────────────────────────────

interface SpatialItem {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  nodeId: string;
}

export interface ViewportBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export type LODLevel = 'full' | 'simplified' | 'dot';

// ── LOD Thresholds ───────────────────────────────────────────────────────────

/**
 * Determine the level-of-detail based on the current zoom factor.
 * - full (>0.7):       All metadata, labels, task dots
 * - simplified (0.3–0.7): Node name + colour only, no metadata
 * - dot (<0.3):        Coloured 4px dots, no text at all
 */
export function determineLOD(zoom: number): LODLevel {
  if (zoom > 0.7) return 'full';
  if (zoom > 0.3) return 'simplified';
  return 'dot';
}

// ── Spatial Index ────────────────────────────────────────────────────────────

// Default node bounding box half-dimensions (pixels at zoom=1)
const NODE_HALF_W = 70;
const NODE_HALF_H = 40;

export class SpatialIndex {
  private tree: RBush<SpatialItem>;
  private items = new Map<string, SpatialItem>();

  constructor() {
    this.tree = new RBush<SpatialItem>();
  }

  /**
   * Insert or update a node's position in the index.
   */
  insert(nodeId: string, pos: NodePosition): void {
    // Remove existing entry if present
    this.remove(nodeId);

    const item: SpatialItem = {
      minX: pos.x - NODE_HALF_W,
      minY: pos.y - NODE_HALF_H,
      maxX: pos.x + NODE_HALF_W,
      maxY: pos.y + NODE_HALF_H,
      nodeId,
    };

    this.items.set(nodeId, item);
    this.tree.insert(item);
  }

  /**
   * Remove a node from the index.
   */
  remove(nodeId: string): void {
    const existing = this.items.get(nodeId);
    if (existing) {
      this.tree.remove(existing, (a, b) => a.nodeId === b.nodeId);
      this.items.delete(nodeId);
    }
  }

  /**
   * Query: which nodes are within the given viewport?
   * Adds a margin (20% of viewport dimensions) for smooth scrolling.
   */
  search(viewport: ViewportBounds, marginFraction = 0.2): string[] {
    const w = viewport.maxX - viewport.minX;
    const h = viewport.maxY - viewport.minY;
    const mx = w * marginFraction;
    const my = h * marginFraction;

    const expanded: ViewportBounds = {
      minX: viewport.minX - mx,
      minY: viewport.minY - my,
      maxX: viewport.maxX + mx,
      maxY: viewport.maxY + my,
    };

    return this.tree.search(expanded).map(item => item.nodeId);
  }

  /**
   * Rebuild the entire index from a positions map.
   */
  rebuild(positions: Record<string, NodePosition>): void {
    this.tree.clear();
    this.items.clear();

    const items: SpatialItem[] = [];
    for (const [nodeId, pos] of Object.entries(positions)) {
      const item: SpatialItem = {
        minX: pos.x - NODE_HALF_W,
        minY: pos.y - NODE_HALF_H,
        maxX: pos.x + NODE_HALF_W,
        maxY: pos.y + NODE_HALF_H,
        nodeId,
      };
      this.items.set(nodeId, item);
      items.push(item);
    }

    // Bulk load is much faster than individual inserts
    this.tree.load(items);
  }

  /**
   * Total number of nodes in the index.
   */
  get size(): number {
    return this.items.size;
  }

  /**
   * Get all node IDs in the index.
   */
  all(): string[] {
    return Array.from(this.items.keys());
  }

  /**
   * Get the full bounding box of all indexed nodes.
   */
  getBounds(): ViewportBounds | null {
    if (this.items.size === 0) return null;
    const data = this.tree.toJSON();
    return {
      minX: (data as { minX: number }).minX,
      minY: (data as { minY: number }).minY,
      maxX: (data as { maxX: number }).maxX,
      maxY: (data as { maxY: number }).maxY,
    };
  }
}

// ── Server-side singleton ────────────────────────────────────────────────────

let _index: SpatialIndex | null = null;

export function getSpatialIndex(): SpatialIndex {
  if (!_index) {
    _index = new SpatialIndex();
  }
  return _index;
}
