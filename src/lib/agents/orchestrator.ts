/**
 * agents/orchestrator.ts — Coordinates multi-node agent analysis.
 * Phase 2: Node-as-an-Agent architecture.
 *
 * The orchestrator spawns NodeAgents for each node (or a subset), runs them
 * in parallel with a concurrency limiter, collects responses, and merges
 * them into a unified recommendation.
 */

import type { ServerGraphState } from '../serverState';
import type { AIProviderConfig } from '../aiClient';
import { NODE_DATA } from '../constants';
import { buildAgentContext, buildGroupContext } from './contextBuilder';
import { NodeAgent } from './nodeAgent';
import { GroupAgent } from './groupAgent';
import type {
  AgentResponse,
  OrchestratorResult,
  SimulationPayload,
  SimulationResult,
  SimulationStep,
  GroupAnalysis,
} from './types';

// ── Concurrency Limiter ──────────────────────────────────────────────────────

class Semaphore {
  private queue: Array<() => void> = [];
  private running = 0;

  constructor(private readonly maxConcurrent: number) {}

  async acquire(): Promise<void> {
    if (this.running < this.maxConcurrent) {
      this.running++;
      return;
    }
    return new Promise<void>(resolve => {
      this.queue.push(() => {
        this.running++;
        resolve();
      });
    });
  }

  release(): void {
    this.running--;
    const next = this.queue.shift();
    if (next) next();
  }
}

// ── Orchestrator ─────────────────────────────────────────────────────────────

export class AgentOrchestrator {
  private readonly state: ServerGraphState;
  private readonly aiConfig: AIProviderConfig;
  private readonly maxConcurrent: number;

  constructor(
    state: ServerGraphState,
    aiConfig: AIProviderConfig,
    maxConcurrent = 5,
  ) {
    this.state = state;
    this.aiConfig = aiConfig;
    this.maxConcurrent = maxConcurrent;
  }

  /**
   * Get all node IDs in the workflow (core + custom, excluding hidden).
   */
  private getAllNodeIds(): string[] {
    const hidden = new Set(this.state.settings?.hiddenCoreNodes ?? []);
    const coreIds = Object.keys(NODE_DATA).filter(id => !hidden.has(id));
    const customIds = this.state.customNodes.map(n => n.id);
    return [...coreIds, ...customIds];
  }

  /**
   * Run a single node agent and return its response.
   */
  async runSingleAgent(nodeId: string, additionalContext?: string): Promise<AgentResponse> {
    const context = buildAgentContext(nodeId, this.state);
    const agent = new NodeAgent(context, this.aiConfig);
    return agent.think(additionalContext);
  }

  /**
   * Run agents for ALL nodes in parallel (with concurrency limit).
   * Collects all responses and merges into a unified result.
   */
  async runFullOrchestration(
    onProgress?: (nodeId: string, status: 'thinking' | 'done' | 'error') => void,
  ): Promise<OrchestratorResult> {
    const startTime = Date.now();
    const nodeIds = this.getAllNodeIds();
    const semaphore = new Semaphore(this.maxConcurrent);

    const responses: AgentResponse[] = [];
    const errors: Array<{ nodeId: string; error: string }> = [];

    const promises = nodeIds.map(async (nodeId) => {
      await semaphore.acquire();
      try {
        onProgress?.(nodeId, 'thinking');
        const response = await this.runSingleAgent(nodeId);
        responses.push(response);
        onProgress?.(nodeId, 'done');
      } catch (err) {
        errors.push({ nodeId, error: err instanceof Error ? err.message : String(err) });
        onProgress?.(nodeId, 'error');
      } finally {
        semaphore.release();
      }
    });

    await Promise.allSettled(promises);

    return this.mergeResponses(responses, Date.now() - startTime);
  }

  /**
   * Run agents for a subset of nodes (e.g. only nodes in a specific group).
   */
  async runSubsetOrchestration(
    nodeIds: string[],
    onProgress?: (nodeId: string, status: 'thinking' | 'done' | 'error') => void,
  ): Promise<OrchestratorResult> {
    const startTime = Date.now();
    const semaphore = new Semaphore(this.maxConcurrent);
    const responses: AgentResponse[] = [];

    const promises = nodeIds.map(async (nodeId) => {
      await semaphore.acquire();
      try {
        onProgress?.(nodeId, 'thinking');
        const response = await this.runSingleAgent(nodeId);
        responses.push(response);
        onProgress?.(nodeId, 'done');
      } catch {
        onProgress?.(nodeId, 'error');
      } finally {
        semaphore.release();
      }
    });

    await Promise.allSettled(promises);
    return this.mergeResponses(responses, Date.now() - startTime);
  }

  /**
   * Simulate a payload flowing through the workflow graph.
   * Each node agent decides whether to process or forward.
   */
  async simulatePayload(payload: SimulationPayload): Promise<SimulationResult> {
    const steps: SimulationStep[] = [];
    let currentNodeId: string | null = payload.startNodeId;
    let totalTime = payload.arrivalTime;
    let bottleneckNodeId: string | null = null;
    const visited = new Set<string>();
    const maxHops = 20; // prevent infinite loops

    while (currentNodeId && !visited.has(currentNodeId) && steps.length < maxHops) {
      visited.add(currentNodeId);

      const context = buildAgentContext(currentNodeId, this.state);
      const agent = new NodeAgent(context, this.aiConfig);

      const simContext = `SIMULATION: A payload "${payload.type}" arrived at your node. Arrival time: ${totalTime} units. Queue depth: ${payload.queueDepth}. Based on your tasks and constraints, respond with JSON: { "canProcess": true/false, "processingTime": number, "forwardTo": "nodeId or null", "isBlocked": true/false, "reason": "explanation" }`;

      const response = await agent.think(simContext);

      // Parse simulation-specific response
      let step: SimulationStep;
      try {
        const simResult = JSON.parse(response.analysis.replace(/```json?\s*/, '').replace(/```$/, ''));
        step = {
          nodeId: currentNodeId,
          nodeName: context.nodeName,
          action: simResult.canProcess ? 'processed' : 'blocked',
          processingTime: simResult.processingTime ?? 1,
          forwardTo: simResult.forwardTo ?? null,
          isBlocked: simResult.isBlocked ?? false,
          reason: simResult.reason ?? response.analysis,
        };
      } catch {
        step = {
          nodeId: currentNodeId,
          nodeName: context.nodeName,
          action: 'processed',
          processingTime: 1,
          forwardTo: context.outboundEdges[0]?.toId ?? null,
          isBlocked: false,
          reason: response.analysis,
        };
      }

      steps.push(step);
      totalTime += step.processingTime;

      if (step.isBlocked) {
        bottleneckNodeId = currentNodeId;
      }

      currentNodeId = step.forwardTo;
    }

    return { payload, steps, totalTime, bottleneckNodeId };
  }

  /**
   * Run group-level analysis for a specific group (Phase 4).
   */
  async runGroupAnalysis(groupId: string): Promise<GroupAnalysis> {
    const context = buildGroupContext(groupId, this.state);
    const agent = new GroupAgent(context, this.aiConfig);
    return agent.analyze();
  }

  /**
   * Run group-level analysis for ALL groups in parallel (Phase 4).
   */
  async runAllGroupAnalysis(
    onProgress?: (groupId: string, status: 'thinking' | 'done' | 'error') => void,
  ): Promise<GroupAnalysis[]> {
    const groups = this.state.settings?.workflowGroups ?? [];
    const semaphore = new Semaphore(this.maxConcurrent);
    const results: GroupAnalysis[] = [];

    const promises = groups.map(async (group) => {
      await semaphore.acquire();
      try {
        onProgress?.(group.id, 'thinking');
        const result = await this.runGroupAnalysis(group.id);
        results.push(result);
        onProgress?.(group.id, 'done');
      } catch {
        onProgress?.(group.id, 'error');
      } finally {
        semaphore.release();
      }
    });

    await Promise.allSettled(promises);
    return results;
  }

  // ── Private: Merge responses ───────────────────────────────────────────────

  private mergeResponses(responses: AgentResponse[], wallTimeMs: number): OrchestratorResult {
    const bottlenecks: OrchestratorResult['bottlenecks'] = [];
    const proposedEdges: OrchestratorResult['proposedEdges'] = [];
    const orphanWarnings: OrchestratorResult['orphanWarnings'] = [];
    const conflicts: OrchestratorResult['conflicts'] = [];

    let totalInput = 0;
    let totalOutput = 0;

    // Track proposed edge additions for conflict detection
    const edgeProposals = new Map<string, string>(); // "src->tgt" → proposing nodeId

    for (const resp of responses) {
      if (resp.tokenUsage) {
        totalInput += resp.tokenUsage.input;
        totalOutput += resp.tokenUsage.output;
      }

      for (const action of resp.suggestedActions) {
        switch (action.type) {
          case 'flag_bottleneck':
            bottlenecks.push({
              nodeId: action.targetNodeId ?? resp.nodeId,
              nodeName: resp.nodeName,
              reason: action.reason,
            });
            break;

          case 'flag_orphan':
            orphanWarnings.push({
              nodeId: action.targetNodeId ?? resp.nodeId,
              nodeName: resp.nodeName,
              reason: action.reason,
            });
            break;

          case 'add_edge':
            if (action.targetNodeId) {
              const key = `${resp.nodeId}->${action.targetNodeId}`;
              proposedEdges.push({
                source: resp.nodeId,
                target: action.targetNodeId,
                reason: action.reason,
              });
              edgeProposals.set(key, resp.nodeId);
            }
            break;

          case 'remove_edge':
            // Check if another agent proposed keeping this edge
            if (action.edgeId) {
              const reverseKey = `${action.targetNodeId}->${resp.nodeId}`;
              if (edgeProposals.has(reverseKey)) {
                conflicts.push({
                  agentA: resp.nodeId,
                  agentB: edgeProposals.get(reverseKey)!,
                  description: `${resp.nodeName} wants to remove edge ${action.edgeId} but another agent proposed adding it`,
                });
              }
            }
            break;
        }
      }
    }

    return {
      responses,
      bottlenecks,
      proposedEdges,
      orphanWarnings,
      conflicts,
      totalTokens: { input: totalInput, output: totalOutput },
      wallTimeMs,
    };
  }
}
