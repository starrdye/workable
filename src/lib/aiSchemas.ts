// src/lib/aiSchemas.ts
// Zod schemas for AI route response shapes (Track 8d).
// Used by parse-workflow and update routes to validate AI output before it
// touches server state.

import { z } from 'zod';

// ─── Shared primitives ────────────────────────────────────────────────────────

const NodeRole = z.enum(['person', 'tool', 'external', 'output']);

const NodeTask = z.object({
  id:       z.string(),
  title:    z.string(),
  status:   z.enum(['todo', 'in-progress', 'done', 'blocked', 'review']).default('todo'),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
  dueDate:  z.string().optional(),
  note:     z.string().optional(),
});

// ─── Parse-workflow AI response ───────────────────────────────────────────────

export const ParsedNode = z.object({
  id:          z.string().regex(/^[a-z0-9_]+$/, 'Node ID must be lowercase alphanumeric/underscores'),
  name:        z.string().min(1),
  initials:    z.string().min(1).max(3),
  role:        NodeRole,
  summary:     z.string().optional(),
  constraints: z.string().optional(),
  tasks:       z.array(NodeTask).optional().default([]),
});

export const ParsedEdge = z.object({
  id:     z.string(),
  source: z.string(),
  target: z.string(),
  name:   z.string().optional(),
});

export const ParsedGroup = z.object({
  id:            z.string(),
  name:          z.string(),
  color:         z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Color must be a 6-digit hex'),
  nodeIds:       z.array(z.string()),
  parentGroupId: z.string().nullable().optional(),
});

/** Shape the AI is expected to return from the parse-workflow route. */
export const ParseWorkflowResponse = z.object({
  nodes:  z.array(ParsedNode),
  edges:  z.array(ParsedEdge),
  groups: z.array(ParsedGroup).optional().default([]),
});

export type ParseWorkflowResponseType = z.infer<typeof ParseWorkflowResponse>;

// ─── AI Update patch response ─────────────────────────────────────────────────

const UpdateNode = z.object({
  id:          z.string(),
  name:        z.string().optional(),
  initials:    z.string().optional(),
  role:        NodeRole.optional(),
  summary:     z.string().optional(),
  constraints: z.string().optional(),
  tasks:       z.array(NodeTask).optional(),
});

const UpdateEdge = z.object({
  id:      z.string(),
  source:  z.string().optional(),
  target:  z.string().optional(),
  name:    z.string().optional(),
  summary: z.string().optional(),
});

const UpdateGroup = z.object({
  id:      z.string(),
  name:    z.string().optional(),
  color:   z.string().optional(),
  nodeIds: z.array(z.string()).optional(),
});

const GroupExtension = z.object({
  groupId:       z.string(),
  addNodeIds:    z.array(z.string()).optional().default([]),
  removeNodeIds: z.array(z.string()).optional().default([]),
});

const GroupPatch = z.object({
  groupId: z.string(),
  name:    z.string().optional(),
  color:   z.string().optional(),
});

const NodeTasks = z.object({
  nodeId: z.string(),
  tasks:  z.array(NodeTask),
});

/** Shape the AI is expected to return from the update route. */
export const AIUpdatePatchResponse = z.object({
  add: z.object({
    nodes:  z.array(UpdateNode).optional().default([]),
    edges:  z.array(UpdateEdge).optional().default([]),
    groups: z.array(UpdateGroup).optional().default([]),
  }).optional().default({ nodes: [], edges: [], groups: [] }),

  remove: z.object({
    nodeIds:  z.array(z.string()).optional().default([]),
    edgeIds:  z.array(z.string()).optional().default([]),
    groupIds: z.array(z.string()).optional().default([]),
  }).optional().default({ nodeIds: [], edgeIds: [], groupIds: [] }),

  update: z.object({
    nodes:           z.array(UpdateNode).optional().default([]),
    edges:           z.array(UpdateEdge).optional().default([]),
    groups:          z.array(GroupPatch).optional().default([]),
    groupExtensions: z.array(GroupExtension).optional().default([]),
    nodeTasks:       z.array(NodeTasks).optional().default([]),
  }).optional().default({ nodes: [], edges: [], groups: [], groupExtensions: [], nodeTasks: [] }),
});

export type AIUpdatePatchResponseType = z.infer<typeof AIUpdatePatchResponse>;

// ─── AI Optimize response ──────────────────────────────────────────────────────

export const CascadeEffectSchema = z.object({
  id:          z.string(),
  type:        z.enum(['stable', 'orphan', 'bottleneck', 'redundant-edge']),
  description: z.string(),
  depth:       z.number().int().min(1),
});

export const SuggestedConnectionSchema = z.object({
  sourceId:       z.string(),
  sourceName:     z.string(),
  targetId:       z.string(),
  targetName:     z.string(),
  connectionName: z.string(),
  connectionType: z.string().optional(),
  reason:         z.string(),
  cascadeEffects: z.array(CascadeEffectSchema).optional(),
});

export const FishboneBoneSchema = z.object({
  category:   z.enum(['People', 'Process', 'Technology', 'Environment']),
  cause:      z.string(),
  resolvedBy: z.object({
    type:  z.enum(['connection', 'edgeRemoval', 'newNode', 'taskUpdate', 'removal', 'groupUpdate']),
    refId: z.string(),
  }).optional(),
});

export const SuggestedRemovalSchema = z.object({
  type:          z.literal('node'),
  id:            z.string(),
  name:          z.string(),
  action:        z.enum(['remove', 'automate', 'merge']),
  reason:        z.string(),
  mergeTargetId: z.string().optional(),
  fishboneBones: z.array(FishboneBoneSchema).optional(),
});

export const SuggestedEdgeRemovalSchema = z.object({
  edgeId:                    z.string(),
  sourceName:                z.string(),
  targetName:                z.string(),
  reason:                    z.string(),
  prerequisiteConnectionId:  z.string().optional(),
});

export const SuggestedNewNodeSchema = z.object({
  tempId:         z.string(),
  label:          z.string(),
  role:           z.string(),
  summary:        z.string(),
  connectFrom:    z.array(z.string()),
  connectTo:      z.array(z.string()),
  replacesNodeId: z.string().optional(),
});

export const SuggestedTaskUpdateSchema = z.object({
  nodeId:      z.string(),
  nodeName:    z.string(),
  addTasks:    z.array(z.object({
    id:     z.string(),
    title:  z.string(),
    status: z.enum(['todo', 'in-progress', 'done', 'blocked', 'review']).default('todo'),
    priority: z.enum(['low', 'medium', 'high']).default('medium'),
  })),
  removeTasks: z.array(z.string()),
  reason:      z.string(),
});

export const SuggestedGroupUpdateSchema = z.object({
  action:        z.enum(['create', 'update', 'delete']),
  // Required for update/delete (existing group ID):
  groupId:       z.string().optional(),
  // Required for create (temp ID referenced by suggestionPlan):
  tempId:        z.string().optional(),
  // Display name of the current group (for update/delete UI):
  currentName:   z.string().optional(),
  // Proposed name (for create/update):
  name:          z.string().optional(),
  // Proposed color — must be a 6-digit hex (for create/update):
  color:         z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  // Full node ID list — for create only:
  nodeIds:       z.array(z.string()).optional(),
  // Incremental node changes — for update only:
  addNodeIds:    z.array(z.string()).default([]),
  removeNodeIds: z.array(z.string()).default([]),
  reason:        z.string(),
});

export const SuggestionPhaseSchema = z.object({
  phaseIndex:         z.number().int().min(1),
  label:              z.string(),
  description:        z.string(),
  prerequisitePhases: z.array(z.number()).default([]),
  suggestionRefs:     z.array(z.object({
    type:  z.enum(['connection', 'edgeRemoval', 'removal', 'newNode', 'taskUpdate', 'groupUpdate']),
    refId: z.string(),
  })),
});

export const OptimizeResponseSchema = z.object({
  analysis:               z.string(),
  suggestedConnections:   z.array(SuggestedConnectionSchema).default([]),
  suggestedEdgeRemovals:  z.array(SuggestedEdgeRemovalSchema).default([]),
  suggestedRemovals:      z.array(SuggestedRemovalSchema).default([]),
  suggestedNewNodes:      z.array(SuggestedNewNodeSchema).default([]),
  suggestedTaskUpdates:   z.array(SuggestedTaskUpdateSchema).default([]),
  suggestedGroupUpdates:  z.array(SuggestedGroupUpdateSchema).default([]),
  suggestionPlan:         z.object({
    phases: z.array(SuggestionPhaseSchema).default([]),
  }).optional(),
});

export type OptimizeResponseType        = z.infer<typeof OptimizeResponseSchema>;
export type SuggestedConnectionType     = z.infer<typeof SuggestedConnectionSchema>;
export type SuggestedEdgeRemovalType    = z.infer<typeof SuggestedEdgeRemovalSchema>;
export type SuggestedRemovalType        = z.infer<typeof SuggestedRemovalSchema>;
export type SuggestedNewNodeType        = z.infer<typeof SuggestedNewNodeSchema>;
export type SuggestedTaskUpdateType     = z.infer<typeof SuggestedTaskUpdateSchema>;
export type SuggestionPhaseType         = z.infer<typeof SuggestionPhaseSchema>;
export type CascadeEffectType           = z.infer<typeof CascadeEffectSchema>;
export type SuggestedGroupUpdateType    = z.infer<typeof SuggestedGroupUpdateSchema>;
