/**
 * agents/distributedOptimize.ts — Distributed implementation of /api/ai/optimize.
 *
 * Replaces the monolithic "one LLM call with full snapshot" approach:
 *   1. Run NodeAgent orchestration (N parallel ego-centric calls)
 *   2. Run GroupAgent analysis for each group
 *   3. Run CascadeSimulator for each proposed edge
 *   4. Adapter converts all results → OptimizeResponse shape
 *
 * The UI (AIAnalysisModal) never knows this happened.
 */

import type { ServerGraphState } from '../serverState';
import type { AIProviderConfig } from '../aiClient';
import { AgentOrchestrator } from './orchestrator';
import { CascadeSimulator } from './cascadeSimulator';
import { orchestratorResultToOptimizeResponse, type OptimizeResponse } from './adapters';
import type { GroupAnalysis, CascadeResult } from './types';

export interface DistributedOptimizeOptions {
  maxConcurrent?: number;
  runGroupAnalysis?: boolean;
  runCascades?: boolean;
}

/**
 * Run the full distributed optimize pipeline.
 * Returns the same shape as the monolithic /api/ai/optimize route.
 */
export async function runDistributedOptimize(
  state: ServerGraphState,
  aiConfig: AIProviderConfig,
  options: DistributedOptimizeOptions = {},
): Promise<OptimizeResponse> {
  const {
    maxConcurrent = 5,
    runGroupAnalysis = true,
    runCascades = true,
  } = options;

  const orchestrator = new AgentOrchestrator(state, aiConfig, maxConcurrent);

  // Step 1: Run all node agents in parallel
  const orchestratorResult = await orchestrator.runFullOrchestration();

  // Step 2: Run group-level analysis (if groups exist)
  let groupAnalyses: GroupAnalysis[] = [];
  if (runGroupAnalysis) {
    const groups = state.settings?.workflowGroups ?? [];
    if (groups.length > 0) {
      groupAnalyses = await orchestrator.runAllGroupAnalysis();
    }
  }

  // Step 3: Run cascade simulation for each proposed edge
  let cascadeResult: CascadeResult | undefined;
  if (runCascades && orchestratorResult.proposedEdges.length > 0) {
    const simulator = new CascadeSimulator(state, aiConfig, {
      maxDepth: 3,
      maxConcurrent: 2,
    });

    // Simulate the first proposed edge (keep cost bounded)
    const firstEdge = orchestratorResult.proposedEdges[0];
    try {
      cascadeResult = await simulator.simulate({
        type: 'add_edge',
        sourceId: firstEdge.source,
        targetId: firstEdge.target,
        description: firstEdge.reason,
      });
    } catch {
      // Cascade failure is non-fatal — we still return the analysis
    }
  }

  // Step 4: Adapt to OptimizeResponse shape
  return orchestratorResultToOptimizeResponse(
    orchestratorResult,
    groupAnalyses,
    cascadeResult,
  );
}
