/**
 * /api/graph-state/viewport — Viewport-aware state endpoint.
 * Phase 5: Infinite canvas & viewport streaming.
 *
 * Returns only nodes + edges within the requested viewport bounds,
 * dramatically reducing payload size for large graphs.
 *
 * Query params:
 *   ?minX=&minY=&maxX=&maxY=  — viewport bounds (required)
 *   &lod=full|simplified|dot  — level of detail (default: full)
 *   &since=<timestamp>        — skip if unchanged (optional)
 *
 * Falls back to full state if no viewport params provided.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getGraphState } from '@/lib/serverState';
import { NODE_DATA, EDGE_DATA } from '@/lib/constants';
import { SpatialIndex, determineLOD, type LODLevel } from '@/lib/spatialIndex';
import type { ServerGraphState, CustomNodeConfig, CustomEdgeConfig } from '@/lib/serverState';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  // Check for ?since= optimization
  const since = Number(searchParams.get('since') ?? '0');
  const state = getGraphState();
  if (since > 0 && state.lastUpdated <= since) {
    return NextResponse.json({ lastUpdated: state.lastUpdated, unchanged: true });
  }

  // Parse viewport bounds
  const minX = Number(searchParams.get('minX'));
  const minY = Number(searchParams.get('minY'));
  const maxX = Number(searchParams.get('maxX'));
  const maxY = Number(searchParams.get('maxY'));

  const hasViewport = [minX, minY, maxX, maxY].every(v => !isNaN(v));

  // If no viewport params, return full state (backward compatible)
  if (!hasViewport) {
    return NextResponse.json(state);
  }

  const lodParam = searchParams.get('lod') as LODLevel | null;
  const lod = lodParam ?? 'full';

  // Build spatial index
  const index = new SpatialIndex();
  const allPositions: Record<string, { x: number; y: number }> = { ...state.baselinePositions };
  // Add custom node positions
  for (const node of state.customNodes) {
    if (node.position) {
      allPositions[node.id] = node.position;
    }
  }
  index.rebuild(allPositions);

  // Query visible nodes
  const visibleNodeIds = new Set(index.search({ minX, minY, maxX, maxY }));

  // Filter state to visible nodes only
  const filteredState = filterState(state, visibleNodeIds, lod);

  return NextResponse.json({
    ...filteredState,
    _viewport: { minX, minY, maxX, maxY, lod },
    _totalNodes: Object.keys(allPositions).length,
    _visibleNodes: visibleNodeIds.size,
  });
}

// ── Filter helpers ───────────────────────────────────────────────────────────

function filterState(
  state: ServerGraphState,
  visibleNodeIds: Set<string>,
  lod: LODLevel,
): Partial<ServerGraphState> {
  // Filter positions
  const baselinePositions: Record<string, { x: number; y: number }> = {};
  const ecosystemPositions: Record<string, { x: number; y: number }> = {};

  for (const id of visibleNodeIds) {
    if (state.baselinePositions[id]) baselinePositions[id] = state.baselinePositions[id];
    if (state.ecosystemPositions[id]) ecosystemPositions[id] = state.ecosystemPositions[id];
  }

  // Filter custom nodes
  const customNodes: CustomNodeConfig[] = state.customNodes.filter(n => visibleNodeIds.has(n.id));

  // Filter edges: keep if either endpoint is visible
  const customEdges: CustomEdgeConfig[] = state.customEdges.filter(
    e => visibleNodeIds.has(e.source) || visibleNodeIds.has(e.target)
  );

  // For simplified/dot LOD, strip metadata to reduce payload
  if (lod === 'dot') {
    return {
      baselinePositions,
      ecosystemPositions,
      customNodes: customNodes.map(n => ({
        id: n.id, label: '', labelInitials: n.labelInitials,
        nodeType: n.nodeType, role: n.role, position: n.position,
      })),
      customEdges: customEdges.map(e => ({
        id: e.id, source: e.source, target: e.target,
      })),
      settings: { nodePause: 1, edgeWeightOverrides: {}, nodeDelayOverrides: {}, metadataOverrides: {} },
      lastUpdated: state.lastUpdated,
    };
  }

  if (lod === 'simplified') {
    // Include node name and role but strip metadata details
    const filteredOverrides: Record<string, { name?: string; role?: string }> = {};
    const overrides = state.settings?.metadataOverrides ?? {};
    for (const id of visibleNodeIds) {
      if (overrides[id]) {
        filteredOverrides[id] = { name: overrides[id].name, role: overrides[id].role };
      }
    }

    return {
      baselinePositions,
      ecosystemPositions,
      customNodes,
      customEdges,
      settings: {
        ...state.settings,
        metadataOverrides: filteredOverrides,
      },
      lastUpdated: state.lastUpdated,
    };
  }

  // Full LOD — return everything for visible nodes
  const filteredOverrides: typeof state.settings.metadataOverrides = {};
  const overrides = state.settings?.metadataOverrides ?? {};
  for (const id of visibleNodeIds) {
    if (overrides[id]) filteredOverrides[id] = overrides[id];
  }

  // Also include groups that have at least one visible member
  const visibleGroups = (state.settings?.workflowGroups ?? []).filter(
    g => g.nodeIds.some(id => visibleNodeIds.has(id))
  );

  return {
    baselinePositions,
    ecosystemPositions,
    originalBaselinePositions: state.originalBaselinePositions,
    originalEcosystemPositions: state.originalEcosystemPositions,
    customNodes,
    customEdges,
    settings: {
      ...state.settings,
      metadataOverrides: filteredOverrides,
      workflowGroups: visibleGroups,
    },
    lastUpdated: state.lastUpdated,
  };
}
