/**
 * /api/ai/cascade — Cascade simulation API route.
 * Phase 3: Message-passing organic cascades.
 *
 * Instead of the current Pass 2 (one LLM predicting all downstream effects),
 * this route lets agents discover cascades organically via message passing.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getGraphState } from '@/lib/serverState';
import { CascadeSimulator } from '@/lib/agents/cascadeSimulator';
import type { AIProvider } from '@/lib/aiClient';
import type { CascadeTrigger } from '@/lib/agents/types';

interface CascadeRequestBody {
  trigger: CascadeTrigger;
  apiKey: string;
  provider: AIProvider;
  model: string;
  baseUrl?: string;
  /** Max cascade depth (default: 5) */
  maxDepth?: number;
}

export async function POST(request: NextRequest) {
  let body: CascadeRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { trigger, apiKey, provider, model, baseUrl, maxDepth } = body;

  if (!trigger || !apiKey || !provider || !model) {
    return NextResponse.json({ error: 'Missing trigger, apiKey, provider, or model' }, { status: 400 });
  }

  if (!trigger.type) {
    return NextResponse.json({ error: 'trigger.type is required' }, { status: 400 });
  }

  const state = getGraphState();
  const aiConfig = { provider, model, apiKey, baseUrl };
  const simulator = new CascadeSimulator(state, aiConfig, {
    maxDepth: maxDepth ?? 5,
    maxConcurrent: 3,
  });

  try {
    const result = await simulator.simulate(trigger);
    return NextResponse.json({ success: true, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
