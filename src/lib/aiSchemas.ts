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
