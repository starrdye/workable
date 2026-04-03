import { NextRequest, NextResponse } from 'next/server';
import {
  getGraphState,
  updateNodePosition,
  addCustomNode,
  addCustomEdge,
  removeNode,
  removeEdge,
  importState,
  importAndResetLayout,
  resetLayout,
  incrementalLayout,
  updateEdgeParams,
  updateNodeDelay,
  updateSettings,
  updateMetadata,
  upsertWorkflowGroup,
  deleteWorkflowGroup,
} from '@/lib/serverState';
import type { GraphAction } from '@/lib/graphActions';

// Performance: client can pass ?since=<lastUpdated> to get a lightweight
// unchanged response instead of the full payload, reducing parse/render overhead.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const since = Number(searchParams.get("since") ?? "0");
  const state = getGraphState();

  // If nothing changed since the client's last known timestamp, return minimal response
  if (since > 0 && state.lastUpdated <= since) {
    return NextResponse.json({ lastUpdated: state.lastUpdated, unchanged: true });
  }

  return NextResponse.json(state);
}

export async function PUT(request: NextRequest) {
  let body: GraphAction;
  try {
    body = await request.json() as GraphAction;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON in request body.' }, { status: 400 });
  }

  switch (body.action) {
    case 'updatePosition':
      updateNodePosition(body.view, body.nodeId, body.position);
      break;
    case 'addNode':
      addCustomNode(body.node);
      break;
    case 'addEdge':
      addCustomEdge(body.edge);
      break;
    case 'deleteNode':
      removeNode(body.nodeId);
      break;
    case 'deleteEdge':
      removeEdge(body.edgeId);
      break;
    case 'updateEdgeParams':
      updateEdgeParams(body.edgeId, {
        sequence: body.sequence,
        weight: body.weight,
        isImprovementOnly: body.isImprovementOnly,
      });
      break;
    case 'updateNodeDelay':
      updateNodeDelay(body.nodeId, body.delay);
      break;
    case 'updateSettings':
      updateSettings(body.settings);
      break;
    case 'updateMetadata':
      updateMetadata(body.id, body.metadata);
      break;
    case 'importState':
      importState({
        baselinePositions:  body.baselinePositions,
        ecosystemPositions: body.ecosystemPositions,
        customNodes:        body.customNodes,
        customEdges:        body.customEdges,
        settings:           body.settings,
      });
      break;
    case 'importAndReset':
      importAndResetLayout({
        baselinePositions:  body.baselinePositions,
        ecosystemPositions: body.ecosystemPositions,
        customNodes:        body.customNodes,
        customEdges:        body.customEdges,
        settings:           body.settings,
      });
      break;
    case 'resetLayout':
      resetLayout();
      break;
    case 'incrementalLayout':
      incrementalLayout(body.nodeIds);
      break;
    case 'upsertWorkflowGroup':
      upsertWorkflowGroup(body.group);
      break;
    case 'deleteWorkflowGroup':
      deleteWorkflowGroup(body.groupId);
      break;
    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  }

  return NextResponse.json({ success: true, state: getGraphState() });
}
