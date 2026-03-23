import { NextRequest, NextResponse } from 'next/server';
import {
  getGraphState,
  updateNodePosition,
  addCustomNode,
  addCustomEdge,
  removeNode,
  removeEdge,
  importState,
  resetLayout,
  updateEdgeParams,
  updateNodeDelay,
  updateSettings,
  updateMetadata,
  upsertWorkflowGroup,
  deleteWorkflowGroup,
  type CustomNodeConfig,
  type CustomEdgeConfig,
  type NodePosition,
  type GlobalSettings,
  type WorkflowGroup,
} from '@/lib/serverState';

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
  const body = await request.json() as {
    action: string;
    view?: 'baseline' | 'ecosystem';
    nodeId?: string;
    edgeId?: string;
    id?: string;
    position?: NodePosition;
    node?: CustomNodeConfig;
    edge?: CustomEdgeConfig;
    baselinePositions?: Record<string, NodePosition>;
    ecosystemPositions?: Record<string, NodePosition>;
    customNodes?: CustomNodeConfig[];
    customEdges?: CustomEdgeConfig[];
    settings?: Partial<GlobalSettings>;
    sequence?: number;
    weight?: number;
    delay?: number;
    isImprovementOnly?: boolean;
    metadata?: {
      name?: string; role?: string; status?: string;
      statusColor?: string; summary?: string; constraints?: string;
      processes?: string[]; connections?: string[];
      tasks?: import('@/lib/serverState').NodeTask[];
    };
    group?: WorkflowGroup;
    groupId?: string;
  };

  switch (body.action) {
    case 'updatePosition':
      if (body.view && body.nodeId && body.position)
        updateNodePosition(body.view, body.nodeId, body.position);
      break;
    case 'addNode':
      if (body.node) addCustomNode(body.node);
      break;
    case 'addEdge':
      if (body.edge) addCustomEdge(body.edge);
      break;
    case 'deleteNode':
      if (body.nodeId) removeNode(body.nodeId);
      break;
    case 'deleteEdge':
      if (body.edgeId) removeEdge(body.edgeId);
      break;
    case 'updateEdgeParams':
      if (body.edgeId) updateEdgeParams(body.edgeId, { sequence: body.sequence, weight: body.weight, isImprovementOnly: body.isImprovementOnly });
      break;
    case 'updateNodeDelay':
      if (body.nodeId && body.delay !== undefined) updateNodeDelay(body.nodeId, body.delay);
      break;
    case 'updateSettings':
      if (body.settings) updateSettings(body.settings);
      break;
    case 'updateMetadata':
      if ((body.id || body.nodeId || body.edgeId) && body.metadata)
        updateMetadata(body.id || body.nodeId || body.edgeId!, body.metadata);
      break;
    case 'importState':
      importState({
        baselinePositions:  body.baselinePositions  || {},
        ecosystemPositions: body.ecosystemPositions || {},
        customNodes:        body.customNodes        || [],
        customEdges:        body.customEdges        || [],
        settings:           body.settings,
      });
      break;
    case 'resetLayout':
      resetLayout();
      break;
    case 'upsertWorkflowGroup':
      if (body.group) upsertWorkflowGroup(body.group);
      break;
    case 'deleteWorkflowGroup':
      if (body.groupId) deleteWorkflowGroup(body.groupId);
      break;
    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  }

  return NextResponse.json({ success: true, state: getGraphState() });
}
