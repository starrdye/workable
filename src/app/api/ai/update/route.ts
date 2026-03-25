import { NextRequest, NextResponse } from 'next/server';
import { generateText, type AIProvider } from '@/lib/aiClient';
import { classifyAIError } from '@/lib/aiErrors';
import { NODE_DATA, EDGE_DATA, CORE_NODE_IDS } from '@/lib/constants';
import { jsonrepair } from 'jsonrepair';
import type { ServerGraphState } from '@/lib/serverState';
import { AIUpdatePatchResponse } from '@/lib/aiSchemas';
import { buildUpdateSnapshot } from '@/lib/snapshotBuilder';

// ── Types ─────────────────────────────────────────────────────────────────────

interface AITaskItem {
  id: string;
  title: string;
  status: 'todo' | 'in-progress' | 'done' | 'blocked' | 'review';
  priority: 'low' | 'medium' | 'high';
  note?: string;
}

export interface AIUpdateAddNode {
  id: string;
  name: string;
  initials: string;
  role: string;
  summary?: string;
  constraints?: string;
  tasks?: AITaskItem[];
}

export interface AIUpdateAddEdge {
  id: string;
  source: string;
  target: string;
  name?: string;
}

export interface AIUpdateAddGroup {
  id: string;
  name: string;
  color: string;
  nodeIds: string[];
  parentGroupId?: string | null;
}

export interface AIUpdateNode {
  id: string;
  name?: string;
  role?: string;
  summary?: string;
  constraints?: string;
}

export interface AIUpdateGroupExtension {
  groupId: string;
  addNodeIds: string[];
  removeNodeIds: string[];
}

export interface AIUpdateGroupPatch {
  groupId: string;
  name?: string;
  color?: string;
}

export interface AIUpdateNodeTasks {
  nodeId: string;
  tasks: AITaskItem[];
}

export interface AIUpdateEdgePatch {
  id: string;
  name?: string;
  summary?: string;
}

export interface AIUpdateResult {
  summary: string;
  add: {
    nodes: AIUpdateAddNode[];
    edges: AIUpdateAddEdge[];
    groups: AIUpdateAddGroup[];
  };
  update: {
    nodes: AIUpdateNode[];
    groupExtensions: AIUpdateGroupExtension[];
    groups: AIUpdateGroupPatch[];
    nodeTasks: AIUpdateNodeTasks[];
    edges: AIUpdateEdgePatch[];
  };
  remove: {
    nodeIds: string[];
    edgeIds: string[];
    groupIds: string[];
  };
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ALLOWED_COLORS = new Set(['#6366F1', '#0EA5E9', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#14B8A6']);
const COLOR_CYCLE    = ['#6366F1', '#0EA5E9', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899', '#14B8A6', '#EF4444'];
const CORE_ID_SET    = new Set<string>(CORE_NODE_IDS);

// ── System prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a workflow patch generator. You receive the current workflow as a structured snapshot, then a plain-English instruction describing what changed. You output ONLY a valid JSON patch — nothing else.

PATCH FORMAT:
{
  "summary": "1-2 sentences describing what changed and why.",
  "add": {
    "nodes": [
      {
        "id": "upd_<shortname>",
        "name": "Full Display Name",
        "initials": "AB",
        "role": "person|tool|external|output",
        "summary": "This entity's role in the workflow.",
        "constraints": "Optional operational/compliance constraints — omit if none.",
        "tasks": [
          { "id": "t_<6chars>", "title": "Concrete task this entity owns", "status": "todo", "priority": "medium", "note": "optional" }
        ]
      }
    ],
    "edges": [
      { "id": "upd_e_<src>_<tgt>", "source": "node_id", "target": "node_id", "name": "Connection label" }
    ],
    "groups": [
      { "id": "upd_grp_<name>", "name": "Group Name", "color": "#6366F1", "nodeIds": ["id1", "id2"] }
    ]
  },
  "update": {
    "nodes": [
      { "id": "existing_node_id", "name": "...", "role": "...", "summary": "...", "constraints": "..." }
    ],
    "groupExtensions": [
      { "groupId": "existing_group_id", "addNodeIds": ["new_or_existing_id"], "removeNodeIds": ["existing_id"] }
    ],
    "groups": [
      { "groupId": "existing_group_id", "name": "New Group Name", "color": "#10B981" }
    ],
    "nodeTasks": [
      {
        "nodeId": "existing_node_id",
        "tasks": [
          { "id": "t_<6chars>", "title": "Task title", "status": "todo", "priority": "medium", "note": "optional" }
        ]
      }
    ],
    "edges": [
      { "id": "existing_edge_id", "name": "New connection label" }
    ]
  },
  "remove": {
    "nodeIds": ["existing_node_id"],
    "edgeIds": ["existing_edge_id"],
    "groupIds": ["existing_group_id"]
  }
}

STRICT RULES:
- New node IDs:  "upd_" prefix + short lowercase (e.g. "upd_bryan", "upd_reuters")
- New edge IDs:  "upd_e_" prefix (e.g. "upd_e_mary_bryan")
- New group IDs: "upd_grp_" prefix (e.g. "upd_grp_mentorship")
- update.nodes: ONLY reference IDs that appear in the snapshot NODES section — only include fields that are changing
- update.groupExtensions: ONLY reference group IDs from the snapshot GROUPS section — use to add/remove nodes from an existing group without renaming it
- update.groups: ONLY reference group IDs from the snapshot GROUPS section — use to rename or recolor a group; only include "name" or "color" that is actually changing; valid colors only
- update.nodeTasks: provides the COMPLETE replacement task list for that node — omit a node entirely to leave its tasks unchanged; ONLY reference node IDs from the snapshot
- update.edges: ONLY reference edge IDs from the snapshot EDGES section — use to rename an existing connection; only include fields that are changing
- remove.nodeIds / remove.edgeIds: ONLY reference IDs from the snapshot
- remove.groupIds: ONLY reference group IDs from the snapshot — removing a group does NOT remove its member nodes
- Edge source/target: must exist in the snapshot OR in add.nodes of this same patch
- Group colors: ONLY from #6366F1, #0EA5E9, #10B981, #F59E0B, #EF4444, #8B5CF6, #EC4899, #14B8A6
- When removing a node, also list ALL its connected edges in remove.edgeIds
- Role types: "person" (human), "tool" (software/system), "external" (external source/trigger), "output" (final artifact)
- Only populate sections relevant to the instruction — use [] for unchanged sections
- Output ONLY the JSON object — no markdown fences, no explanation text`;

// ── Snapshot builder ──────────────────────────────────────────────────────────
// Delegated to src/lib/snapshotBuilder.ts (Track 14b-i: hierarchical group summaries).
// buildUpdateSnapshot is imported above and used directly in the route handler.

// ── JSON extraction (same as parse-workflow) ──────────────────────────────────

function extractJSON(text: string): string {
  let s = text.replace(/^```(?:json)?\s*/im, '').replace(/\s*```\s*$/m, '').trim();
  const start = s.indexOf('{');
  if (start === -1) return s;
  let depth = 0, end = -1;
  for (let i = start; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  return end !== -1 ? s.slice(start, end + 1) : s.slice(start);
}

// ── Patch validation ──────────────────────────────────────────────────────────

function validatePatch(
  raw: Partial<AIUpdateResult>,
  state: ServerGraphState
): AIUpdateResult {
  // Build sets of known IDs
  const hiddenCore  = new Set(state.settings?.hiddenCoreNodes ?? []);
  const knownNodes  = new Set<string>([
    ...Object.keys(NODE_DATA).filter(id => !hiddenCore.has(id)),
    ...state.customNodes.map(n => n.id),
  ]);
  const knownEdges = new Set<string>([
    ...Object.keys(EDGE_DATA),
    ...state.customEdges.map(e => e.id),
  ]);
  const knownGroups = new Set<string>((state.settings?.workflowGroups ?? []).map(g => g.id));

  const add      = raw.add      ?? { nodes: [], edges: [], groups: [] };
  const update   = raw.update   ?? { nodes: [], groupExtensions: [], groups: [], nodeTasks: [], edges: [] };
  const remove   = raw.remove   ?? { nodeIds: [], edgeIds: [], groupIds: [] };

  // --- validate add.nodes ---
  const newNodeIds = new Set<string>();
  const validAddNodes: AIUpdateAddNode[] = (add.nodes ?? []).filter(n => {
    if (!n.id || !n.name) return false;
    // Enforce upd_ prefix and no collision with existing
    const id = n.id.startsWith('upd_') ? n.id : `upd_${n.id}`;
    n.id = id;
    if (knownNodes.has(id)) return false; // collision — skip
    newNodeIds.add(id);
    return true;
  });

  const allNodeIds = new Set([...knownNodes, ...newNodeIds]);

  // --- validate add.edges ---
  const newEdgeIds = new Set<string>();
  const validAddEdges: AIUpdateAddEdge[] = (add.edges ?? []).filter(e => {
    if (!e.id || !e.source || !e.target) return false;
    const id = e.id.startsWith('upd_') ? e.id : `upd_e_${e.source}_${e.target}`;
    e.id = id;
    if (knownEdges.has(id)) return false;
    // Both endpoints must exist (in snapshot or in add.nodes)
    if (!allNodeIds.has(e.source) || !allNodeIds.has(e.target)) return false;
    newEdgeIds.add(id);
    return true;
  });

  // --- validate add.groups ---
  const colorIdx = (state.settings?.workflowGroups?.length ?? 0);
  const validAddGroups: AIUpdateAddGroup[] = (add.groups ?? []).map((g, i) => {
    const id = g.id.startsWith('upd_grp_') ? g.id : `upd_grp_${g.id}`;
    const color = ALLOWED_COLORS.has(g.color) ? g.color : COLOR_CYCLE[(colorIdx + i) % COLOR_CYCLE.length];
    const nodeIds = (g.nodeIds ?? []).filter(id => allNodeIds.has(id));
    return { ...g, id, color, nodeIds };
  }).filter(g => g.name);

  // --- validate update.nodes (must exist in snapshot, not in new nodes) ---
  const validUpdateNodes: AIUpdateNode[] = (update.nodes ?? []).filter(n =>
    n.id && knownNodes.has(n.id)
  );

  // --- validate update.groupExtensions ---
  const validGroupExts: AIUpdateGroupExtension[] = (update.groupExtensions ?? []).filter(ext =>
    ext.groupId && knownGroups.has(ext.groupId)
  ).map(ext => ({
    ...ext,
    addNodeIds:    (ext.addNodeIds    ?? []).filter(id => allNodeIds.has(id)),
    removeNodeIds: (ext.removeNodeIds ?? []).filter(id => knownNodes.has(id)),
  }));

  // --- validate update.groups (rename/recolor) ---
  const validUpdateGroups: AIUpdateGroupPatch[] = (update.groups ?? []).filter(g =>
    g.groupId && knownGroups.has(g.groupId)
  ).map(g => ({
    groupId: g.groupId,
    ...(g.name  ? { name:  g.name  } : {}),
    ...(g.color && ALLOWED_COLORS.has(g.color) ? { color: g.color } : {}),
  })).filter(g => g.name !== undefined || g.color !== undefined);

  // --- validate update.nodeTasks ---
  const validNodeTasks: AIUpdateNodeTasks[] = (update.nodeTasks ?? []).filter(nt =>
    nt.nodeId && knownNodes.has(nt.nodeId) && Array.isArray(nt.tasks)
  ).map(nt => ({
    nodeId: nt.nodeId,
    tasks: nt.tasks.map(t => ({
      id:       t.id || `t_${Math.random().toString(36).slice(2, 8)}`,
      title:    t.title,
      status:   (['todo','in-progress','done','blocked','review'].includes(t.status) ? t.status : 'todo') as AITaskItem['status'],
      priority: (['low','medium','high'].includes(t.priority) ? t.priority : 'medium') as AITaskItem['priority'],
      ...(t.note ? { note: t.note } : {}),
    })),
  }));

  // --- validate update.edges ---
  const validUpdateEdges: AIUpdateEdgePatch[] = (update.edges ?? []).filter(e =>
    e.id && knownEdges.has(e.id) && (e.name || e.summary)
  );

  // --- validate remove.groupIds ---
  const validRemoveGroupIds = (remove.groupIds ?? []).filter(id => knownGroups.has(id));

  // --- validate remove ---
  // Never remove core/protected nodes
  const validRemoveNodeIds = (remove.nodeIds ?? []).filter(id =>
    knownNodes.has(id) && !CORE_ID_SET.has(id)
  );
  // Also cascade-remove any edge whose node is being removed
  const removedNodeSet = new Set(validRemoveNodeIds);
  const allRemoveEdgeIds = new Set([
    ...(remove.edgeIds ?? []).filter(id => knownEdges.has(id)),
    ...state.customEdges
      .filter(e => removedNodeSet.has(e.source) || removedNodeSet.has(e.target))
      .map(e => e.id),
  ]);

  return {
    summary: typeof raw.summary === 'string' ? raw.summary : 'Workflow updated.',
    add:    { nodes: validAddNodes, edges: validAddEdges, groups: validAddGroups },
    update: { nodes: validUpdateNodes, groupExtensions: validGroupExts, groups: validUpdateGroups, nodeTasks: validNodeTasks, edges: validUpdateEdges },
    remove: { nodeIds: validRemoveNodeIds, edgeIds: [...allRemoveEdgeIds], groupIds: validRemoveGroupIds },
  };
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const { prompt, currentState, apiKey, provider = 'anthropic', model, baseUrl } = await req.json() as {
      prompt: string;
      currentState: ServerGraphState;
      apiKey: string;
      provider?: AIProvider;
      model?: string;
      baseUrl?: string;
    };

    if (!apiKey?.trim())     return NextResponse.json({ error: 'API key is required.'           }, { status: 400 });
    if (!prompt?.trim())     return NextResponse.json({ error: 'Update prompt is required.'     }, { status: 400 });
    if (!currentState)       return NextResponse.json({ error: 'Current workflow state is required.' }, { status: 400 });

    const resolvedModel = model?.trim() || (() => {
      const defaults: Record<AIProvider, string> = {
        anthropic: 'claude-sonnet-4-6',
        gemini:    'gemini-2.0-flash',
        doubao:    '',
      };
      return defaults[provider] ?? '';
    })();

    if (!resolvedModel) {
      return NextResponse.json(
        { error: provider === 'doubao'
            ? 'No Doubao endpoint ID configured. Add your endpoint ID (ep-…) in AI Settings.'
            : 'No model configured for this provider.' },
        { status: 400 }
      );
    }

    const snapshot = buildUpdateSnapshot(currentState);

    const genResult = await generateText({
      provider,
      model:        resolvedModel,
      apiKey,
      systemPrompt: SYSTEM_PROMPT,
      userMessage:  `CURRENT WORKFLOW:\n${snapshot}\n\nUPDATE INSTRUCTION:\n${prompt}`,
      maxTokens:    4000,
      baseUrl:      baseUrl || undefined,
    });
    const rawText = genResult.text;

    let parsed: Partial<AIUpdateResult>;
    try {
      const rawParsed = JSON.parse(jsonrepair(extractJSON(rawText)));

      // 8d — Zod schema validation (soft: log warnings, fall through to validatePatch)
      const zodResult = AIUpdatePatchResponse.safeParse(rawParsed);
      if (zodResult.success) {
        parsed = zodResult.data as Partial<AIUpdateResult>;
      } else {
        console.warn('[ai/update] Zod validation warnings:', zodResult.error.flatten());
        parsed = rawParsed;
      }
    } catch {
      return NextResponse.json(
        { error: 'AI returned invalid JSON. Try rephrasing your update.', rawAIResponse: rawText },
        { status: 422 }
      );
    }

    const result = validatePatch(parsed, currentState);
    return NextResponse.json(result);

  } catch (err: unknown) {
    const { userMessage, status } = classifyAIError(err);
    return NextResponse.json({ error: userMessage }, { status });
  }
}
