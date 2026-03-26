/**
 * /api/ai/agent — Node-as-an-Agent API route.
 * Phase 2: Distributed node-level analysis.
 *
 * Modes:
 *   - single:       Run one NodeAgent for a specific node
 *   - orchestrate:  Run agents for ALL nodes in parallel
 *   - simulate:     Run a payload simulation through the graph
 */

import { NextRequest, NextResponse } from 'next/server';
import { getGraphState } from '@/lib/serverState';
import { AgentOrchestrator } from '@/lib/agents/orchestrator';
import type { AIProvider } from '@/lib/aiClient';
import type { SimulationPayload } from '@/lib/agents/types';

interface AgentRequestBody {
  mode: 'single' | 'orchestrate' | 'simulate';
  nodeId?: string;
  /** For simulate mode */
  payload?: SimulationPayload;
  /** Subset of node IDs to orchestrate (optional — defaults to all) */
  nodeIds?: string[];
  /** AI config */
  apiKey: string;
  provider: AIProvider;
  model: string;
  baseUrl?: string;
}

export async function POST(request: NextRequest) {
  let body: AgentRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { mode, nodeId, payload, nodeIds, apiKey, provider, model, baseUrl } = body;

  if (!apiKey || !provider || !model) {
    return NextResponse.json({ error: 'Missing apiKey, provider, or model' }, { status: 400 });
  }

  const state = getGraphState();
  const aiConfig = { provider, model, apiKey, baseUrl };
  const orchestrator = new AgentOrchestrator(state, aiConfig, 5);

  try {
    switch (mode) {
      case 'single': {
        if (!nodeId) {
          return NextResponse.json({ error: 'nodeId required for single mode' }, { status: 400 });
        }
        const response = await orchestrator.runSingleAgent(nodeId);
        return NextResponse.json({ success: true, response });
      }

      case 'orchestrate': {
        const result = nodeIds?.length
          ? await orchestrator.runSubsetOrchestration(nodeIds)
          : await orchestrator.runFullOrchestration();
        return NextResponse.json({ success: true, result });
      }

      case 'simulate': {
        if (!payload) {
          return NextResponse.json({ error: 'payload required for simulate mode' }, { status: 400 });
        }
        const result = await orchestrator.simulatePayload(payload);
        return NextResponse.json({ success: true, result });
      }

      default:
        return NextResponse.json({ error: `Unknown mode: ${mode}` }, { status: 400 });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
