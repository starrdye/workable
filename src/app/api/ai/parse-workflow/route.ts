import { NextRequest, NextResponse } from 'next/server';
import { generateText, type AIProvider } from '@/lib/aiClient';
import { classifyAIError } from '@/lib/aiErrors';
import type { CustomNodeConfig, CustomEdgeConfig, WorkflowGroup } from '@/lib/serverState';
import { hierarchicalLayout, groupAwareLayout } from '@/lib/layout';
import { CORE_NODE_IDS } from '@/lib/constants';
import { jsonrepair } from 'jsonrepair';
import { ParseWorkflowResponse } from '@/lib/aiSchemas';
import { JACK_ROUTINE_DEMO_AI_JSON, JACK_ROUTINE_DEMO_AI_JSON_ZH } from '@/lib/demoAnalysis';

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

/**
 * Robustly extract a JSON object from an AI response.
 * Handles: markdown fences, preamble text, postamble text, and
 * responses where the model wraps the JSON in extra explanation.
 */
function extractJSON(text: string): string {
  // 1. Strip markdown code fences (```json ... ``` or ``` ... ```)
  let s = text.replace(/^```(?:json)?\s*/im, '').replace(/\s*```\s*$/m, '').trim();

  // 2. Find the outermost JSON object by scanning for first '{' and matching '}'
  const start = s.indexOf('{');
  if (start === -1) return s; // no object found — let JSON.parse fail with a clear error

  let depth = 0;
  let end   = -1;
  for (let i = start; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }

  return end !== -1 ? s.slice(start, end + 1) : s.slice(start);
}

const ALLOWED_COLORS = new Set(["#6366F1","#0EA5E9","#10B981","#F59E0B","#EF4444","#8B5CF6","#EC4899"]);
const COLOR_CYCLE = ["#6366F1","#0EA5E9","#10B981","#F59E0B","#8B5CF6","#EC4899","#EF4444"];

/**
 * Track 4d — DFS cycle detection.
 * Returns true if edges contain a cycle; mutates edges to break the back-edge.
 */
function breakCycles(nodes: AINode[], edges: AIEdge[]): string[] {
  const adj = new Map<string, string[]>();
  nodes.forEach(n => adj.set(n.id, []));
  edges.forEach(e => { adj.get(e.source)?.push(e.target); });

  const visited  = new Set<string>();
  const inStack  = new Set<string>();
  const backEdges: string[] = [];

  function dfs(nodeId: string) {
    visited.add(nodeId);
    inStack.add(nodeId);
    for (const neighbor of (adj.get(nodeId) ?? [])) {
      if (!visited.has(neighbor)) {
        dfs(neighbor);
      } else if (inStack.has(neighbor)) {
        // Back-edge found — record it for removal
        const id = `e_${nodeId}_${neighbor}`;
        backEdges.push(id);
      }
    }
    inStack.delete(nodeId);
  }

  nodes.forEach(n => { if (!visited.has(n.id)) dfs(n.id); });

  // Remove the identified back-edges from the edges array
  if (backEdges.length > 0) {
    const backSet = new Set(backEdges);
    for (let i = edges.length - 1; i >= 0; i--) {
      const e = edges[i];
      if (backSet.has(e.id) || backSet.has(`e_${e.source}_${e.target}`)) {
        edges.splice(i, 1);
      }
    }
  }

  return backEdges;
}

function sanitizeGroups(groups: AIGroup[], nodeIds: Set<string>): WorkflowGroup[] {
  // Build a map of canonical group IDs first (for parentGroupId resolution)
  const rawGroups = (groups ?? []).filter(g => g.id && g.name && Array.isArray(g.nodeIds));
  const idMap = new Map<string, string>(); // original → canonical
  rawGroups.forEach(g => {
    const canonical = g.id.startsWith('grp_') ? g.id : `grp_${g.id}`;
    idMap.set(g.id, canonical);
  });

  // Recursively collect all nodeIds for a group (own + all descendants from sanitization tree)
  const getSubtreeNodeIds = (groupId: string): string[] => {
    const g = rawGroups.find(x => x.id === groupId);
    if (!g) return [];
    
    // Direct nodes
    const ids = [...g.nodeIds];
    // Immediate children nodes (recursive)
    rawGroups
      .filter(child => child.parentGroupId === groupId)
      .forEach(child => {
        ids.push(...getSubtreeNodeIds(child.id));
      });
    return ids;
  };

  const result: WorkflowGroup[] = [];
  rawGroups.forEach((g, i) => {
    const canonical = idMap.get(g.id)!;
    const isSubgroup = !!g.parentGroupId;
    const parentCanonical = g.parentGroupId ? (idMap.get(g.parentGroupId) ?? g.parentGroupId) : undefined;

    // A group's effective nodeIds should be all its own nodes PLUS all descendants.
    // This ensures node counts in the Sidebar are correct.
    const rawOwnedIds = getSubtreeNodeIds(g.id);
    const ownedIds = Array.from(new Set(rawOwnedIds)).filter(id => nodeIds.has(id));

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
    const body = await req.json();
    const { prompt, apiKey, provider = 'anthropic', model, baseUrl, lang = 'en' } = body as {
      prompt: string;
      apiKey: string;
      provider?: AIProvider;
      model?: string;
      baseUrl?: string;
      lang?: string;
    };

    // Demo provider: skip API key check and use pre-built JSON response
    const isDemoProvider = provider === 'demo';

    if (!isDemoProvider && !apiKey?.trim()) return NextResponse.json({ error: 'API key is required.'              }, { status: 400 });
    if (!prompt?.trim())                    return NextResponse.json({ error: 'Workflow description is required.' }, { status: 400 });

    const resolvedModel = model?.trim() || (() => {
      const defaults: Record<AIProvider, string> = {
        anthropic: 'claude-sonnet-4-6',
        gemini:    'gemini-2.0-flash',
        doubao:    '',
        demo:      'demo-mock',
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

    // For demo provider, skip the AI call and use pre-built JSON
    let rawText: string;
    let genResult: { usage: { inputTokens: number; outputTokens: number } | null } = { usage: null };
    if (isDemoProvider) {
      rawText = lang === 'zh' ? JACK_ROUTINE_DEMO_AI_JSON_ZH : JACK_ROUTINE_DEMO_AI_JSON;
    } else {
      const result = await generateText({
        provider,
        model: resolvedModel,
        apiKey,
        systemPrompt: SYSTEM_PROMPT,
        userMessage:  prompt,
        maxTokens:    8000,
        baseUrl:      baseUrl || undefined,
      });
      rawText = result.text;
      genResult = result;
    }

    let parsed: { nodes: AINode[]; edges: AIEdge[]; groups?: AIGroup[] };
    try {
      const rawParsed = JSON.parse(jsonrepair(extractJSON(rawText)));

      // 8d — Zod schema validation (soft: log warnings but fall through to existing validation)
      const zodResult = ParseWorkflowResponse.safeParse(rawParsed);
      if (zodResult.success) {
        // Use Zod-coerced data (fills defaults, strips extra fields)
        parsed = zodResult.data as typeof parsed;
      } else {
        // Log but continue — the manual validation below will still catch hard errors
        console.warn('[parse-workflow] Zod validation warnings:', zodResult.error.flatten());
        parsed = rawParsed;
      }
    } catch {
      return NextResponse.json(
        {
          error: 'AI returned invalid JSON. Try rephrasing your workflow description.',
          rawAIResponse: rawText,
          promptUsed: prompt,
        },
        { status: 422 }
      );
    }

    if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
      return NextResponse.json({ error: 'AI response is missing nodes or edges.' }, { status: 422 });
    }

    // Track 4d: Break cycles before layout
    const brokenCycleEdgeIds = breakCycles(parsed.nodes, parsed.edges);
    const warnings = brokenCycleEdgeIds.length > 0
      ? [`${brokenCycleEdgeIds.length} cyclic connection(s) were automatically removed to ensure a valid workflow layout.`]
      : [];

    const { baselinePositions, ecosystemPositions } = calcPositions(parsed.nodes, parsed.edges, parsed.groups ?? []);

    const customNodes: CustomNodeConfig[] = parsed.nodes.map((n) => ({
      id:            n.id,
      labelInitials: n.initials || n.name.slice(0, 2).toUpperCase(),
      label:         n.name,
      nodeType:      'neural' as const,
      role:          mapRole(n.role),
      source:        'ai-generated' as const,
      position:      baselinePositions[n.id],
    }));

    const customEdges: CustomEdgeConfig[] = parsed.edges.map((e) => ({
      id:       e.id || `e_${e.source}_${e.target}`,
      source:   e.source,
      target:   e.target,
      sequence: 1,
      weight:   1,
      isCustom: true,
      ...(e.name ? { name: e.name } : {}),
    }));

    // metadataOverrides carries display-layer fields for every AI node.
    // name + role are always written so the sidebar never falls back to
    // "Custom Node" / "User Added" for AI-generated nodes.
    const metadataOverrides: Record<string, {
      name?: string; role?: string; summary?: string; constraints?: string; tasks?: AITaskItem[]; connections?: string[]; processes?: string[];
    }> = {};
    for (const n of parsed.nodes) {
      metadataOverrides[n.id] = {
        name: n.name,
        role: mapRole(n.role),
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

    // Store edge names in metadataOverrides so the sidebar can display them.
    for (const e of parsed.edges) {
      const edgeId = e.id || `e_${e.source}_${e.target}`;
      if (e.name) {
        metadataOverrides[edgeId] = {
          name:    e.name,
          summary: e.name,
        };
      }
    }

    const nodeIdSet = new Set(customNodes.map(n => n.id));
    const workflowGroups = sanitizeGroups(parsed.groups ?? [], nodeIdSet);

    // Build a name lookup so we can label connections by display name, not raw id.
    const nodeNameMap = new Map<string, string>(parsed.nodes.map(n => [n.id, n.name]));

    // Derive connections (all directly connected nodes, either direction) and
    // processes (workflow group memberships) for each node and store them so
    // the sidebar can display them without falling back to static dummy data.
    for (const n of parsed.nodes) {
      const neighbourNames = new Set<string>();
      for (const e of parsed.edges) {
        if (e.source === n.id && nodeNameMap.has(e.target)) {
          neighbourNames.add(nodeNameMap.get(e.target)!);
        }
        if (e.target === n.id && nodeNameMap.has(e.source)) {
          neighbourNames.add(nodeNameMap.get(e.source)!);
        }
      }

      // Workflow groups this node belongs to (use sanitized groups for accuracy).
      const groupNames = workflowGroups
        .filter(g => g.nodeIds.includes(n.id))
        .map(g => g.name);

      metadataOverrides[n.id] = {
        ...metadataOverrides[n.id],
        connections: [...neighbourNames],
        processes:   groupNames,
      };
    }

    return NextResponse.json({
      customNodes,
      customEdges,
      baselinePositions,
      ecosystemPositions,
      metadataOverrides,
      workflowGroups,
      settings: {
        hiddenCoreNodes: [...CORE_NODE_IDS],
        ...(isDemoProvider ? { templateId: 'demo-jack' } : {}),
      },
      nodeCount: customNodes.length,
      edgeCount: customEdges.length,
      rawAIResponse: rawText,
      promptUsed: prompt,
      warnings,
      // Track 4e: token usage
      usage: genResult.usage,
    });
  } catch (err: unknown) {
    const { userMessage, status } = classifyAIError(err);
    return NextResponse.json({ error: userMessage }, { status });
  }
}
