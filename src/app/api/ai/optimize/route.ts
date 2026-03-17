import { NextRequest, NextResponse } from 'next/server';
import { generateText, type AIProvider } from '@/lib/aiClient';
import { NODE_DATA, EDGE_DATA } from '@/lib/constants';

const SYSTEM_PROMPT = `You are a workflow optimization expert specializing in business process improvement and operational efficiency.

Analyze the provided workflow graph and deliver a structured, actionable report. Format your response using this exact structure:

## Workflow Summary
2–3 sentences describing the overall workflow, its purpose, and current state.

## Bottlenecks Identified
List each bottleneck as a bullet point. For each one, name the node/step and explain why it slows the process.

## Optimization Recommendations
Provide 3–5 specific, actionable improvements. Each should reference actual nodes or edges from the workflow by name.

## Quick Wins
1–2 changes that can be implemented immediately with the highest impact-to-effort ratio.

Be concise, practical, and base all recommendations on the actual graph data provided.`;

export async function POST(req: NextRequest) {
  try {
    const { workflowData, apiKey, provider = 'anthropic', model } = await req.json() as {
      workflowData: Record<string, unknown>;
      apiKey: string;
      provider?: AIProvider;
      model?: string;
    };

    if (!apiKey?.trim())    return NextResponse.json({ error: 'API key is required.'      }, { status: 400 });
    if (!workflowData)      return NextResponse.json({ error: 'Workflow data is required.' }, { status: 400 });

    const resolvedModel = model?.trim() || (() => {
      const defaults: Record<AIProvider, string> = {
        anthropic: 'claude-sonnet-4-6',
        gemini:    'gemini-2.0-flash',
        doubao:    '', // must be supplied by user (Ark endpoint ID)
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

    // Build a readable snapshot of the current workflow for the AI
    const coreNodes = Object.entries(NODE_DATA).map(([id, n]) => ({
      id, name: n.name, role: n.role, status: n.status, summary: n.summary,
    }));

    const coreEdges = Object.entries(EDGE_DATA).map(([id, e]) => ({
      id, name: e.name, status: e.status, summary: e.summary,
    }));

    const customNodes = ((workflowData.customNodes ?? []) as Array<{ id: string; label: string; role: string }>)
      .map((n) => ({ id: n.id, name: n.label, role: n.role }));

    const customEdges = ((workflowData.customEdges ?? []) as Array<{ id: string; source: string; target: string; isImprovementOnly?: boolean }>)
      .map((e) => ({ id: e.id, source: e.source, target: e.target, isImprovementOnly: e.isImprovementOnly ?? false }));

    const metadataOverrides = (workflowData as { settings?: { metadataOverrides?: unknown } })
      .settings?.metadataOverrides ?? {};

    const workflowSummary = JSON.stringify(
      { coreNodes, coreEdges, customNodes, customEdges, metadataOverrides },
      null, 2
    );

    const analysis = await generateText({
      provider,
      model: resolvedModel,
      apiKey,
      systemPrompt: SYSTEM_PROMPT,
      userMessage:  `Analyze this workflow and provide optimization recommendations:\n\n${workflowSummary}`,
      maxTokens:    1024,
    });

    return NextResponse.json({ analysis });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (message.includes('401') || message.includes('invalid_api_key') || message.includes('API_KEY')) {
      return NextResponse.json({ error: 'Invalid API key. Please check your key in AI Settings.' }, { status: 401 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
