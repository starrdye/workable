import { NextRequest, NextResponse } from 'next/server';
import { generateText, type AIProvider } from '@/lib/aiClient';
import type { CustomNodeConfig, CustomEdgeConfig, WorkflowGroup } from '@/lib/serverState';
import { hierarchicalLayout, groupAwareLayout } from '@/lib/layout';
import { CORE_NODE_IDS } from '@/lib/constants';

const SYSTEM_PROMPT = `You are a workflow graph parser. Convert natural language workflow descriptions into structured JSON graphs.

Output ONLY valid JSON with this exact structure:
{
  "nodes": [
    {
      "id": "unique_lowercase_id",
      "name": "Full Display Name",
      "initials": "AB",
      "role": "person|tool|external|output",
      "summary": "Brief description of this entity's role in the workflow",
      "constraints": "Optional: known operational, compliance, or technical constraints. Omit if none.",
      "tasks": [
        {
          "id": "t_unique_suffix",
          "title": "Concrete actionable task this entity owns",
          "status": "todo",
          "priority": "high",
          "note": "Optional one-line detail"
        }
      ]
    }
  ],
  "edges": [
    {
      "id": "e_sourceid_targetid",
      "source": "source_node_id",
      "target": "target_node_id",
      "name": "Connection or flow name"
    }
  ],
  "groups": [
    {
      "id": "grp_phase1",
      "name": "Phase Name",
      "color": "#6366F1",
      "nodeIds": ["node_id1", "node_id2"],
      "parentGroupId": null
    },
    {
      "id": "grp_subphase",
      "name": "Sub-Phase Name",
      "color": "#0EA5E9",
      "nodeIds": ["node_id3"],
      "parentGroupId": "grp_phase1"
    }
  ]
}

Node rules:
- Node IDs: lowercase alphanumeric and underscores only, must be unique
- Initials: 2-3 uppercase characters representing the entity
- Role types: "person" (human reviewer/approver), "tool" (software/internal system), "external" (external data source/trigger), "output" (final destination/artifact)
- Edges represent data/work flow direction — source produces output consumed by target
- constraints: only fill in when you can infer a real constraint; leave out otherwise
- tasks: generate 1-3 concrete tasks per node that this entity owns in the workflow
  - Task IDs: use format "t_" + 6-char alphanumeric unique suffix
  - status: "todo" | "in-progress" | "done" | "blocked" | "review"
  - priority: "low" | "medium" | "high"
  - note: one-line optional clarification; omit if obvious
  - Only include tasks clearly implied by the workflow description

Group rules:
- Create 2-5 groups (including subgroups) representing natural phases or clusters
- Top-level groups: set parentGroupId to null — these are major workflow phases
- Subgroups: set parentGroupId to the id of their parent group — use when a phase has distinct sub-phases worth calling out separately
- Examples of top-level groups: "Data Ingestion", "Processing", "Review & Approval", "Output & Delivery"
- Examples of subgroups: "Automated Check" and "Manual Override" inside "Processing"
- Assign colors ONLY from this palette: #6366F1, #0EA5E9, #10B981, #F59E0B, #EF4444, #8B5CF6, #EC4899
- Every node must belong to exactly one group (top-level OR subgroup — not both)
- Parent groups must NOT list nodeIds themselves if they have subgroups — their area is the union of subgroup areas
- Group IDs: use format "grp_" followed by a short lowercase descriptor (e.g. "grp_input")
- Only create subgroups when the workflow genuinely has nested structure; prefer flat groups for simple workflows

Output ONLY the JSON object — no markdown fences, no explanation text`;

interface AITaskItem {
  id: string;
  title: string;
  status: "todo" | "in-progress" | "done" | "blocked" | "review";
  priority: "low" | "medium" | "high";
  note?: string;
}

interface AINode {
  id: string;
  name: string;
  initials: string;
  role: string;
  summary: string;
  constraints?: string;
  tasks?: AITaskItem[];
}

interface AIEdge {
  id: string;
  source: string;
  target: string;
  name: string;
}

interface AIGroup {
  id: string;
  name: string;
  color: string;
  nodeIds: string[];
  parentGroupId?: string | null;
}

function mapRole(role: string): CustomNodeConfig['role'] {
  if (role === 'person')   return 'person';
  if (role === 'output')   return 'output';
  if (role === 'external') return 'external';
  return 'tool';
}

/** Dynamic canvas sizing — more nodes → larger spread */
function calcCanvasSize(nodeCount: number): { w: number; h: number } {
  // Scale by node count so small graphs aren't spread across a 1200px canvas.
  // MAX_LAYER_SPACING_X (230) in hierarchicalLayout prevents sparse graphs from
  // consuming the full width even when the canvas is large.
  const w = Math.max(900, nodeCount * 140);
  const h = Math.max(720, Math.min(nodeCount, 6) * 150);
  return { w, h };
}

function calcPositions(nodes: AINode[], edges: AIEdge[], groups: AIGroup[]) {
  const { w, h } = calcCanvasSize(nodes.length);
  let baselinePositions = hierarchicalLayout(nodes, edges, w, h);
  // Apply group-aware horizontal zone assignment only at generation time.
  // Pass the full group list — groupAwareLayout handles top-level filtering
  // and recurses into subgroups to collect effective nodeIds.
  if (groups.length > 0) {
    // Normalise null → undefined for parentGroupId so it satisfies LayoutGroup
    const layoutGroups = groups.map(g => ({
      id:       g.id,
      nodeIds:  g.nodeIds,
      ...(g.parentGroupId ? { parentGroupId: g.parentGroupId } : {}),
    }));
    baselinePositions = groupAwareLayout(baselinePositions, layoutGroups, w, edges);
  }
  return { baselinePositions, ecosystemPositions: {} as Record<string, { x: number; y: number }> };
}

function stripFences(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
}

const ALLOWED_COLORS = new Set(["#6366F1","#0EA5E9","#10B981","#F59E0B","#EF4444","#8B5CF6","#EC4899"]);
const COLOR_CYCLE = ["#6366F1","#0EA5E9","#10B981","#F59E0B","#8B5CF6","#EC4899","#EF4444"];

function sanitizeGroups(groups: AIGroup[], nodeIds: Set<string>): WorkflowGroup[] {
  // Build a map of canonical group IDs first (for parentGroupId resolution)
  const rawGroups = (groups ?? []).filter(g => g.id && g.name && Array.isArray(g.nodeIds));
  const idMap = new Map<string, string>(); // original → canonical
  rawGroups.forEach(g => {
    const canonical = g.id.startsWith('grp_') ? g.id : `grp_${g.id}`;
    idMap.set(g.id, canonical);
  });

  // Nodes in subgroups should NOT also appear in top-level groups (avoid double rendering).
  // Collect all nodeIds claimed by subgroups first.
  const subgroupNodeIds = new Set<string>();
  rawGroups.forEach(g => {
    if (g.parentGroupId) g.nodeIds.forEach(id => subgroupNodeIds.add(id));
  });

  const result: WorkflowGroup[] = [];
  rawGroups.forEach((g, i) => {
    const canonical = idMap.get(g.id)!;
    const isSubgroup = !!g.parentGroupId;
    const parentCanonical = g.parentGroupId ? (idMap.get(g.parentGroupId) ?? g.parentGroupId) : undefined;

    // For top-level groups: exclude nodes already owned by a subgroup
    const ownedIds = isSubgroup
      ? g.nodeIds.filter(id => nodeIds.has(id))
      : g.nodeIds.filter(id => nodeIds.has(id) && !subgroupNodeIds.has(id));

    if (ownedIds.length === 0 && !isSubgroup) return; // skip empty top-level groups

    result.push({
      id:            canonical,
      name:          g.name,
      color:         ALLOWED_COLORS.has(g.color) ? g.color : COLOR_CYCLE[i % COLOR_CYCLE.length],
      nodeIds:       ownedIds,
      ...(parentCanonical ? { parentGroupId: parentCanonical } : {}),
    });
  });

  return result;
}

export async function POST(req: NextRequest) {
  try {
    const { prompt, apiKey, provider = 'anthropic', model } = await req.json() as {
      prompt: string;
      apiKey: string;
      provider?: AIProvider;
      model?: string;
    };

    if (!apiKey?.trim())  return NextResponse.json({ error: 'API key is required.'              }, { status: 400 });
    if (!prompt?.trim())  return NextResponse.json({ error: 'Workflow description is required.' }, { status: 400 });

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

    const rawText = await generateText({
      provider,
      model: resolvedModel,
      apiKey,
      systemPrompt: SYSTEM_PROMPT,
      userMessage:  prompt,
      maxTokens:    3000,
    });

    let parsed: { nodes: AINode[]; edges: AIEdge[]; groups?: AIGroup[] };
    try {
      parsed = JSON.parse(stripFences(rawText));
    } catch {
      return NextResponse.json(
        { error: 'AI returned invalid JSON. Try rephrasing your workflow description.' },
        { status: 422 }
      );
    }

    if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
      return NextResponse.json({ error: 'AI response is missing nodes or edges.' }, { status: 422 });
    }

    const { baselinePositions, ecosystemPositions } = calcPositions(parsed.nodes, parsed.edges, parsed.groups ?? []);

    const customNodes: CustomNodeConfig[] = parsed.nodes.map((n) => ({
      id:            n.id,
      labelInitials: n.initials || n.name.slice(0, 2).toUpperCase(),
      label:         n.name,
      nodeType:      'neural' as const,
      role:          mapRole(n.role),
      position:      baselinePositions[n.id],
    }));

    const customEdges: CustomEdgeConfig[] = parsed.edges.map((e) => ({
      id:       e.id || `e_${e.source}_${e.target}`,
      source:   e.source,
      target:   e.target,
      sequence: 1,
      weight:   1,
      isCustom: true,
    }));

    const metadataOverrides: Record<string, { summary?: string; constraints?: string; tasks?: AITaskItem[] }> = {};
    for (const n of parsed.nodes) {
      if (n.summary || n.constraints || n.tasks?.length) {
        metadataOverrides[n.id] = {
          ...(n.summary     ? { summary:     n.summary     } : {}),
          ...(n.constraints ? { constraints: n.constraints } : {}),
          ...(n.tasks?.length ? { tasks: n.tasks.map(t => ({
            id:       t.id || `t_${Math.random().toString(36).slice(2, 8)}`,
            title:    t.title,
            status:   (["todo","in-progress","done","blocked","review"].includes(t.status) ? t.status : "todo") as AITaskItem["status"],
            priority: (["low","medium","high"].includes(t.priority) ? t.priority : "medium") as AITaskItem["priority"],
            ...(t.note ? { note: t.note } : {}),
          })) } : {}),
        };
      }
    }

    const nodeIdSet = new Set(customNodes.map(n => n.id));
    const workflowGroups = sanitizeGroups(parsed.groups ?? [], nodeIdSet);

    return NextResponse.json({
      customNodes,
      customEdges,
      baselinePositions,
      ecosystemPositions,
      metadataOverrides,
      workflowGroups,
      settings: { hiddenCoreNodes: [...CORE_NODE_IDS] },
      nodeCount: customNodes.length,
      edgeCount: customEdges.length,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (message.includes('401') || message.includes('invalid_api_key') || message.includes('API_KEY')) {
      return NextResponse.json({ error: 'Invalid API key. Please check your key in AI Settings.' }, { status: 401 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
