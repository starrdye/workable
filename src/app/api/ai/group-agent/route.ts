/**
 * /api/ai/group-agent — Group-level governance API route.
 * Phase 4: Group-level distributed analysis.
 *
 * Modes:
 *   - single:  Analyse one group
 *   - all:     Analyse all groups in parallel
 */

import { NextRequest, NextResponse } from 'next/server';
import { getGraphState } from '@/lib/serverState';
import { AgentOrchestrator } from '@/lib/agents/orchestrator';
import type { AIProvider } from '@/lib/aiClient';

interface GroupAgentRequestBody {
  mode: 'single' | 'all';
  groupId?: string;
  apiKey: string;
  provider: AIProvider;
  model: string;
  baseUrl?: string;
}

export async function POST(request: NextRequest) {
  let body: GroupAgentRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { mode, groupId, apiKey, provider, model, baseUrl } = body;

  if (!apiKey || !provider || !model) {
    return NextResponse.json({ error: 'Missing apiKey, provider, or model' }, { status: 400 });
  }

  const state = getGraphState();
  const aiConfig = { provider, model, apiKey, baseUrl };
  const orchestrator = new AgentOrchestrator(state, aiConfig, 5);

  try {
    switch (mode) {
      case 'single': {
        if (!groupId) {
          return NextResponse.json({ error: 'groupId required for single mode' }, { status: 400 });
        }
        const groups = state.settings?.workflowGroups ?? [];
        if (!groups.find(g => g.id === groupId)) {
          return NextResponse.json({ error: `Group "${groupId}" not found` }, { status: 404 });
        }
        const result = await orchestrator.runGroupAnalysis(groupId);
        return NextResponse.json({ success: true, result });
      }

      case 'all': {
        const results = await orchestrator.runAllGroupAnalysis();
        return NextResponse.json({ success: true, results });
      }

      default:
        return NextResponse.json({ error: `Unknown mode: ${mode}` }, { status: 400 });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
