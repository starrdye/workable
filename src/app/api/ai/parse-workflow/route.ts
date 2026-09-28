import { NextRequest, NextResponse } from 'next/server';
import { generateText, type AIProvider } from '@/lib/aiClient';
import { classifyAIError } from '@/lib/aiErrors';
import { buildWorkflowFromText, PARSE_WORKFLOW_SYSTEM_PROMPT, WorkflowParseError } from '@/lib/parseWorkflow';

export async function POST(req: NextRequest) {
  try {
    const { prompt, apiKey, provider = 'anthropic', model, baseUrl } = await req.json() as {
      prompt: string;
      apiKey: string;
      provider?: AIProvider;
      model?: string;
      baseUrl?: string;
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

    const genResult = await generateText({
      provider,
      model: resolvedModel,
      apiKey,
      systemPrompt: PARSE_WORKFLOW_SYSTEM_PROMPT,
      userMessage:  prompt,
      maxTokens:    8000,
      baseUrl:      baseUrl || undefined,
    });
    const rawText = genResult.text;

    let workflow;
    try {
      workflow = buildWorkflowFromText(rawText);
    } catch (err) {
      if (err instanceof WorkflowParseError) {
        return NextResponse.json({ error: err.message, rawAIResponse: rawText, promptUsed: prompt }, { status: 422 });
      }
      throw err;
    }

    return NextResponse.json({
      ...workflow,
      rawAIResponse: rawText,
      promptUsed: prompt,
      // Track 4e: token usage
      usage: genResult.usage,
    });
  } catch (err: unknown) {
    const { userMessage, status } = classifyAIError(err);
    return NextResponse.json({ error: userMessage }, { status });
  }
}
