import { NextRequest, NextResponse } from 'next/server';
import { generateText, type AIProvider } from '@/lib/aiClient';
import type { CustomNodeConfig, CustomEdgeConfig } from '@/lib/serverState';

const SYSTEM_PROMPT = `You are a workflow graph parser. Convert natural language workflow descriptions into structured JSON graphs.

Output ONLY valid JSON with this exact structure:
{
  "nodes": [
    {
      "id": "unique_lowercase_id",
      "name": "Full Display Name",
      "initials": "AB",
      "role": "person|tool|external|output",
      "summary": "Brief description of this entity's role in the workflow"
    }
  ],
  "edges": [
    {
      "id": "e_sourceid_targetid",
      "source": "source_node_id",
      "target": "target_node_id",
      "name": "Connection or flow name"
    }
  ]
}

Rules:
- Node IDs: lowercase alphanumeric and underscores only, must be unique
- Initials: 2-3 uppercase characters representing the entity
- Role types: "person" (human reviewer/approver), "tool" (software/internal system), "external" (external data source), "output" (final destination)
- Edges represent data/work flow direction — source produces output consumed by target
- Output ONLY the JSON object — no markdown fences, no explanation text`;

interface AINode {
  id: string;
  name: string;
  initials: string;
  role: string;
  summary: string;
}

interface AIEdge {
  id: string;
  source: string;
  target: string;
  name: string;
}

function mapRole(role: string): CustomNodeConfig['role'] {
  if (role === 'person')   return 'person';
  if (role === 'output')   return 'output';
  if (role === 'external') return 'external';
  return 'tool';
}

function calcPositions(nodes: AINode[]) {
  const count = nodes.length;
  const baselinePositions:  Record<string, { x: number; y: number }> = {};
  const ecosystemPositions: Record<string, { x: number; y: number }> = {};

  nodes.forEach((node, i) => {
    const spanX  = Math.min(800, (count - 1) * 160);
    const startX = 100 + (900 - 100 - spanX) / 2;
    const x      = count > 1 ? startX + (i * spanX) / (count - 1) : 500;
    baselinePositions[node.id] = { x, y: 250 };

    const angle  = (2 * Math.PI * i) / count - Math.PI / 2;
    const radius = Math.min(200, 60 + count * 20);
    ecosystemPositions[node.id] = {
      x: Math.round(450 + radius * Math.cos(angle)),
      y: Math.round(280 + radius * Math.sin(angle)),
    };
  });

  return { baselinePositions, ecosystemPositions };
}

// Strip markdown code fences that some models add despite instructions
function stripFences(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/,           '')
    .trim();
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

    // Resolve model: caller supplies it, or fall back to a sensible default per provider
    const resolvedModel = model?.trim() || (() => {
      const defaults: Record<AIProvider, string> = {
        anthropic: 'claude-sonnet-4-6',
        gemini:    'gemini-2.0-flash',
        doubao:    'doubao-1-5-pro-32k',
      };
      return defaults[provider] ?? 'claude-sonnet-4-6';
    })();

    const rawText = await generateText({
      provider,
      model: resolvedModel,
      apiKey,
      systemPrompt: SYSTEM_PROMPT,
      userMessage:  prompt,
      maxTokens:    2048,
    });

    let parsed: { nodes: AINode[]; edges: AIEdge[] };
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

    const { baselinePositions, ecosystemPositions } = calcPositions(parsed.nodes);

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

    const metadataOverrides: Record<string, { summary?: string }> = {};
    for (const n of parsed.nodes) {
      if (n.summary) metadataOverrides[n.id] = { summary: n.summary };
    }

    return NextResponse.json({
      customNodes,
      customEdges,
      baselinePositions,
      ecosystemPositions,
      metadataOverrides,
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
