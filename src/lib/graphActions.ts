// src/lib/graphActions.ts
// Discriminated union for every PUT /api/graph-state action body.
// Replaces the loose { action: string; [key: string]: unknown } type used in route.ts.
// This catches mismatched action/payload pairs at compile time.
// Track 8c

import type {
  CustomNodeConfig,
  CustomEdgeConfig,
  NodePosition,
  GlobalSettings,
  WorkflowGroup,
  NodeTask,
} from '@/lib/serverState';

export type GraphAction =
  | { action: 'updatePosition';   view: 'baseline' | 'ecosystem'; nodeId: string; position: NodePosition }
  | { action: 'addNode';          node: CustomNodeConfig }
  | { action: 'addEdge';          edge: CustomEdgeConfig }
  | { action: 'deleteNode';       nodeId: string }
  | { action: 'deleteEdge';       edgeId: string }
  | { action: 'updateEdgeParams'; edgeId: string; sequence?: number; weight?: number; isImprovementOnly?: boolean }
  | { action: 'updateNodeDelay';  nodeId: string; delay: number }
  | { action: 'updateSettings';   settings: Partial<GlobalSettings> }
  | { action: 'updateMetadata';   id: string; metadata: MetadataPatch }
  | { action: 'importState';
      baselinePositions:  Record<string, NodePosition>;
      ecosystemPositions: Record<string, NodePosition>;
      customNodes:        CustomNodeConfig[];
      customEdges:        CustomEdgeConfig[];
      settings?:          Partial<GlobalSettings> }
  | { action: 'importAndReset';
      baselinePositions:  Record<string, NodePosition>;
      ecosystemPositions: Record<string, NodePosition>;
      customNodes:        CustomNodeConfig[];
      customEdges:        CustomEdgeConfig[];
      settings?:          Partial<GlobalSettings> }
  | { action: 'resetLayout' }
  | { action: 'incrementalLayout'; nodeIds: string[] }
  | { action: 'upsertWorkflowGroup'; group: WorkflowGroup }
  | { action: 'deleteWorkflowGroup'; groupId: string };

export interface MetadataPatch {
  name?: string;
  role?: string;
  status?: string;
  statusColor?: string;
  summary?: string;
  constraints?: string;
  processes?: string[];
  connections?: string[];
  tasks?: NodeTask[];
}
