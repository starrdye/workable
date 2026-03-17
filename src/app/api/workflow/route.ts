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
    // curveTension and zLayer are optional UI hints — not required for workflow import
    customEdges: graphState.customEdges,
    lastUpdated: graphState.lastUpdated,
  });
}
