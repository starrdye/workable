import { NextResponse } from 'next/server';
import { getGraphState } from '@/lib/serverState';

import { NODE_DATA, EDGE_DATA } from '@/lib/constants';

export async function GET() {
  const graphState = getGraphState();
  return NextResponse.json({
    nodes: NODE_DATA,
    edges: EDGE_DATA,
    layout: {
      baselinePositions: graphState.baselinePositions,
      ecosystemPositions: graphState.ecosystemPositions,
    },
    customNodes: graphState.customNodes,
    customEdges: graphState.customEdges,
    lastUpdated: graphState.lastUpdated,
  });
}
