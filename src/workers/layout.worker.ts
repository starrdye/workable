// src/workers/layout.worker.ts
// Web Worker that runs hierarchicalLayout + groupAwareLayout off the main thread.
// Communicated via comlink (Track 5c).
// The layout functions are pure JS — no DOM, no Node-only APIs — so they run
// identically in a Worker context.

import { expose } from 'comlink';
import { hierarchicalLayout, groupAwareLayout } from '@/lib/layout';

export interface LayoutRequest {
  nodes:   { id: string }[];
  edges:   { source: string; target: string }[];
  groups:  { id: string; name: string; color: string; nodeIds: string[]; parentGroupId?: string }[];
  canvasW: number;
  canvasH: number;
}

export type PositionMap = Record<string, { x: number; y: number }>;

const api = {
  computeLayout({ nodes, edges, groups, canvasW, canvasH }: LayoutRequest): PositionMap {
    let positions = hierarchicalLayout(nodes, edges, canvasW, canvasH);
    if (groups.length > 0) {
      positions = groupAwareLayout(positions, groups, canvasW, edges);
    }
    return positions;
  },
};

expose(api);
