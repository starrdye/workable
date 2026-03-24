// src/__tests__/layout.test.ts
// Tests for hierarchicalLayout — pure function, deterministic, snapshot-safe.
// Track 8a

import { describe, it, expect } from 'vitest';
import { hierarchicalLayout } from '@/lib/layout';
import type { LayoutNode, LayoutEdge } from '@/lib/layout';

const W = 900;
const H = 720;

describe('hierarchicalLayout', () => {
  it('returns empty object for empty node list', () => {
    const result = hierarchicalLayout([], [], W, H);
    expect(result).toEqual({});
  });

  it('assigns a position to a single node', () => {
    const nodes: LayoutNode[] = [{ id: 'a' }];
    const result = hierarchicalLayout(nodes, [], W, H);
    expect(result['a']).toBeDefined();
    expect(typeof result['a'].x).toBe('number');
    expect(typeof result['a'].y).toBe('number');
  });

  it('assigns distinct positions to multiple disconnected nodes', () => {
    const nodes: LayoutNode[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const result = hierarchicalLayout(nodes, [], W, H);
    expect(Object.keys(result)).toHaveLength(3);

    // All positions must be finite numbers
    for (const id of ['a', 'b', 'c']) {
      expect(isFinite(result[id].x)).toBe(true);
      expect(isFinite(result[id].y)).toBe(true);
    }

    // Positions must not all be identical (layout must spread nodes)
    const coords = ['a', 'b', 'c'].map(id => `${result[id].x},${result[id].y}`);
    const unique = new Set(coords);
    expect(unique.size).toBeGreaterThan(1);
  });

  it('assigns positions within canvas bounds (with generous margin)', () => {
    const nodes: LayoutNode[] = [
      { id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' },
    ];
    const edges: LayoutEdge[] = [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'c' },
      { source: 'c', target: 'd' },
    ];
    const result = hierarchicalLayout(nodes, edges, W, H);
    const MARGIN = 200; // nodes can go slightly outside but shouldn't be wildly off
    for (const id of ['a', 'b', 'c', 'd']) {
      expect(result[id].x).toBeGreaterThan(-MARGIN);
      expect(result[id].x).toBeLessThan(W + MARGIN);
      expect(result[id].y).toBeGreaterThan(-MARGIN);
      expect(result[id].y).toBeLessThan(H + MARGIN);
    }
  });

  it('handles a simple 2-node edge graph', () => {
    const nodes: LayoutNode[] = [{ id: 'src' }, { id: 'tgt' }];
    const edges: LayoutEdge[] = [{ source: 'src', target: 'tgt' }];
    const result = hierarchicalLayout(nodes, edges, W, H);

    expect(result['src']).toBeDefined();
    expect(result['tgt']).toBeDefined();
    // Source should be to the left of target in a hierarchical layout
    expect(result['src'].x).toBeLessThanOrEqual(result['tgt'].x);
  });

  it('handles all nodes with edges forming a chain', () => {
    const ids = ['n1', 'n2', 'n3', 'n4', 'n5'];
    const nodes: LayoutNode[] = ids.map(id => ({ id }));
    const edges: LayoutEdge[] = ids.slice(0, -1).map((id, i) => ({
      source: id,
      target: ids[i + 1],
    }));
    const result = hierarchicalLayout(nodes, edges, W, H);
    expect(Object.keys(result)).toHaveLength(5);
    for (const id of ids) {
      expect(isFinite(result[id].x)).toBe(true);
    }
  });

  it('is deterministic — same input always yields same output', () => {
    const nodes: LayoutNode[] = [{ id: 'x' }, { id: 'y' }, { id: 'z' }];
    const edges: LayoutEdge[] = [
      { source: 'x', target: 'y' },
      { source: 'y', target: 'z' },
    ];
    const r1 = hierarchicalLayout(nodes, edges, W, H);
    const r2 = hierarchicalLayout(nodes, edges, W, H);
    expect(r1).toEqual(r2);
  });
});
