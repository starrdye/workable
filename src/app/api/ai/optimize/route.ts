import { NextRequest, NextResponse } from 'next/server';
import { generateText, type AIProvider } from '@/lib/aiClient';
import { NODE_DATA, EDGE_DATA } from '@/lib/constants';

const SYSTEM_PROMPT = `You are a workflow optimization expert specializing in business process improvement and operational efficiency.

Analyze the provided workflow graph and return ONLY a valid JSON object with this exact structure:

{
  "analysis": "## Workflow Summary\\n...\\n## Bottlenecks Identified\\n...\\n## Constraint Analysis\\n...\\n## Quick Wins\\n...",
  "suggestedConnections": [
    {
      "sourceId": "existing_node_id",
      "sourceName": "Source Node Name",
      "targetId": "existing_node_id",
      "targetName": "Target Node Name",
      "connectionName": "Short label for this connection",
      "connectionType": "optimised",
      "reason": "One sentence explaining why this connection improves the workflow."
    }
  ],
  "suggestedRemovals": [
    {
      "type": "node",
      "id": "existing_node_id",
      "name": "Entity Name",
      "action": "remove|automate|merge",
      "reason": "One sentence explaining why this entity should be removed, automated, or merged."
    }
  ]
}

Rules for the analysis field:
- Use \\n for line breaks inside the JSON string
- Include these sections: ## Workflow Summary, ## Bottlenecks Identified, ## Constraint Analysis, ## Quick Wins
- Each section is 2-5 bullet points using "- " prefix

Rules for suggestedConnections:
- Propose 1-3 new directed connections that would optimise the workflow (e.g. bypass a bottleneck, add automation)
- connectionType is always "optimised" (these are improvement-mode-only connections)
- Only reference node IDs that actually exist in the workflow data provided
- If no useful connections can be suggested, return an empty array []

Rules for suggestedRemovals:
- Propose 0-3 entities (nodes) that are redundant, automatable, or could be merged
- action: "remove" = delete entirely, "automate" = replace human with tool, "merge" = fold into another node
- Only reference node IDs that actually exist in the workflow data provided
- If no removals are warranted, return an empty array []

Output ONLY the JSON object — no markdown fences, no extra text`;

function stripFences(text: string): string {
  return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
}

export async function POST(req: NextRequest) {
  try {
    const { workflowData, apiKey, provider = 'anthropic', model, baseUrl } = await req.json() as {
      workflowData: Record<string, unknown>;
      apiKey: string;
      provider?: AIProvider;
      model?: string;
      baseUrl?: string;
    };

    if (!apiKey?.trim())    return NextResponse.json({ error: 'API key is required.'      }, { status: 400 });
    if (!workflowData)      return NextResponse.json({ error: 'Workflow data is required.' }, { status: 400 });

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

    const metadataOverrides = (workflowData as { settings?: { metadataOverrides?: Record<string, { constraints?: string }> } })
      .settings?.metadataOverrides ?? {};

    const coreNodes = Object.entries(NODE_DATA).map(([id, n]) => {
      const meta = metadataOverrides[id];
      return { id, name: n.name, role: n.role, status: n.status, summary: n.summary,
        ...(meta?.constraints ? { constraints: meta.constraints } : {}) };
    });

    const coreEdges = Object.entries(EDGE_DATA).map(([id, e]) => ({
      id, name: e.name, status: e.status, summary: e.summary,
    }));

    const customNodes = ((workflowData.customNodes ?? []) as Array<{ id: string; label: string; role: string }>)
      .map((n) => {
        const meta = metadataOverrides[n.id];
        return { id: n.id, name: n.label, role: n.role, ...(meta?.constraints ? { constraints: meta.constraints } : {}) };
      });

    const customEdges = ((workflowData.customEdges ?? []) as Array<{ id: string; source: string; target: string; isImprovementOnly?: boolean }>)
      .map((e) => ({ id: e.id, source: e.source, target: e.target, isImprovementOnly: e.isImprovementOnly ?? false }));

    const workflowSummary = JSON.stringify(
      { coreNodes, coreEdges, customNodes, customEdges, metadataOverrides },
      null, 2
    );

    const rawText = await generateText({
      provider,
      model: resolvedModel,
      apiKey,
      systemPrompt: SYSTEM_PROMPT,
      userMessage:  `Analyze this workflow and provide optimization recommendations:\n\n${workflowSummary}`,
      maxTokens:    2000,
      baseUrl:      baseUrl || undefined,
    });

    // Try to parse as structured JSON; fall back to plain analysis text
    let analysis: string;
    let suggestedConnections: unknown[] = [];
    let suggestedRemovals: unknown[] = [];

    try {
      const parsed = JSON.parse(stripFences(rawText)) as {
        analysis?: string;
        suggestedConnections?: unknown[];
        suggestedRemovals?: unknown[];
      };
      analysis             = parsed.analysis ?? rawText;
      suggestedConnections = Array.isArray(parsed.suggestedConnections) ? parsed.suggestedConnections : [];
      suggestedRemovals    = Array.isArray(parsed.suggestedRemovals)    ? parsed.suggestedRemovals    : [];
    } catch {
      // AI didn't return JSON — treat the whole text as the analysis
      analysis = rawText;
    }

    return NextResponse.json({ analysis, suggestedConnections, suggestedRemovals });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (message.includes('401') || message.includes('invalid_api_key') || message.includes('API_KEY')) {
      return NextResponse.json({ error: 'Invalid API key. Please check your key in AI Settings.' }, { status: 401 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
