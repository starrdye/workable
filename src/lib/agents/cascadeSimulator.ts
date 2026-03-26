/**
 * agents/cascadeSimulator.ts — Organic cascade simulation via agent messaging.
 * Phase 3: Message passing cascades.
 *
 * Instead of one LLM predicting all downstream effects (current Pass 2),
 * this simulator lets agents discover cascades organically:
 *   1. Trigger event → affected agents receive messages
 *   2. Each agent reasons about the change using its ego-centric context
 *   3. Agent sends reaction messages to neighbours
 *   4. Neighbours react and propagate further (bounded by MAX_DEPTH)
 *   5. Orchestrator collects all reactions into a cascade report
 */

import type { ServerGraphState } from '../serverState';
import type { AIProviderConfig } from '../aiClient';
import { EDGE_DATA } from '../constants';
import { buildAgentContext } from './contextBuilder';
import { NodeAgent } from './nodeAgent';
import { MessageBroker, MAX_CASCADE_DEPTH } from './messageBroker';
import type {
  CascadeTrigger,
  CascadeResult,
  CascadeStep,
  AgentMessage,
  AgentAction,
} from './types';

// ── Cascade Simulator ────────────────────────────────────────────────────────

export class CascadeSimulator {
  private readonly state: ServerGraphState;
  private readonly aiConfig: AIProviderConfig;
  private readonly maxDepth: number;
  private readonly maxConcurrent: number;

  constructor(
    state: ServerGraphState,
    aiConfig: AIProviderConfig,
    options?: { maxDepth?: number; maxConcurrent?: number },
  ) {
    this.state = state;
    this.aiConfig = aiConfig;
    this.maxDepth = options?.maxDepth ?? MAX_CASCADE_DEPTH;
    this.maxConcurrent = options?.maxConcurrent ?? 3;
  }

  /**
   * Simulate a cascade triggered by a workflow change.
   */
  async simulate(
    trigger: CascadeTrigger,
    onStep?: (step: CascadeStep) => void,
  ): Promise<CascadeResult> {
    const startTime = Date.now();
    const steps: CascadeStep[] = [];
    let totalInput = 0;
    let totalOutput = 0;
    let totalAgentCalls = 0;

    // Collect all edges for the message broker
    const allEdges = this.collectEdges();
    const broker = new MessageBroker(allEdges, this.maxDepth);

    try {
      // Identify directly affected nodes
      const affectedNodeIds = this.getAffectedNodes(trigger);

      // BFS cascade: process depth by depth
      let currentDepth = 0;
      let currentWave = affectedNodeIds;
      const processed = new Set<string>();

      while (currentWave.length > 0 && currentDepth <= this.maxDepth) {
        const nextWave: string[] = [];

        // Process current wave (with concurrency limit)
        const batchResults = await this.processBatch(
          currentWave, trigger, currentDepth, processed
        );

        for (const result of batchResults) {
          totalAgentCalls++;
          if (result.tokenUsage) {
            totalInput += result.tokenUsage.input;
            totalOutput += result.tokenUsage.output;
          }

          const step: CascadeStep = {
            nodeId: result.nodeId,
            nodeName: result.nodeName,
            depth: currentDepth,
            reaction: result.analysis,
            propagatesTo: result.messagesOut.map(m => m.toNodeId),
            suggestedActions: result.suggestedActions,
          };

          steps.push(step);
          onStep?.(step);
          processed.add(result.nodeId);

          // Collect next-wave node IDs from outgoing messages
          for (const msg of result.messagesOut) {
            if (!processed.has(msg.toNodeId) && msg.toNodeId !== 'broadcast') {
              nextWave.push(msg.toNodeId);
              broker.send({ ...msg, depth: currentDepth + 1 });
            }
          }
        }

        currentWave = [...new Set(nextWave)]; // deduplicate
        currentDepth++;
      }

      return {
        trigger,
        steps,
        totalAgentCalls,
        totalTokens: { input: totalInput, output: totalOutput },
        wallTimeMs: Date.now() - startTime,
      };
    } finally {
      broker.destroy();
    }
  }

  // ── Private ────────────────────────────────────────────────────────────────

  /**
   * Get the node IDs directly affected by the trigger.
   */
  private getAffectedNodes(trigger: CascadeTrigger): string[] {
    switch (trigger.type) {
      case 'remove_edge':
        return [trigger.sourceId, trigger.targetId].filter(Boolean) as string[];

      case 'add_edge':
        return [trigger.sourceId, trigger.targetId].filter(Boolean) as string[];

      case 'remove_node':
        if (!trigger.nodeId) return [];
        // Find all neighbours of the removed node
        const neighbours = new Set<string>();
        for (const edge of this.state.customEdges) {
          if (edge.source === trigger.nodeId) neighbours.add(edge.target);
          if (edge.target === trigger.nodeId) neighbours.add(edge.source);
        }
        for (const [edgeId] of Object.entries(EDGE_DATA)) {
          const hyphen = edgeId.indexOf('-');
          if (hyphen === -1) continue;
          const src = edgeId.slice(0, hyphen);
          const tgt = edgeId.slice(hyphen + 1);
          if (src === trigger.nodeId) neighbours.add(tgt);
          if (tgt === trigger.nodeId) neighbours.add(src);
        }
        return Array.from(neighbours);

      case 'bottleneck_resolve':
        return trigger.nodeId ? [trigger.nodeId] : [];

      default:
        return [];
    }
  }

  /**
   * Process a batch of nodes at the same cascade depth.
   */
  private async processBatch(
    nodeIds: string[],
    trigger: CascadeTrigger,
    depth: number,
    alreadyProcessed: Set<string>,
  ) {
    const toProcess = nodeIds.filter(id => !alreadyProcessed.has(id));

    // Build trigger context string for agents
    const triggerContext = this.buildTriggerContext(trigger, depth);

    // Process with concurrency limit
    const results: Array<{
      nodeId: string;
      nodeName: string;
      analysis: string;
      suggestedActions: AgentAction[];
      messagesOut: AgentMessage[];
      tokenUsage?: { input: number; output: number };
    }> = [];

    // Simple concurrency limiter
    const batches: string[][] = [];
    for (let i = 0; i < toProcess.length; i += this.maxConcurrent) {
      batches.push(toProcess.slice(i, i + this.maxConcurrent));
    }

    for (const batch of batches) {
      const batchPromises = batch.map(async (nodeId) => {
        const context = buildAgentContext(nodeId, this.state);
        const agent = new NodeAgent(context, this.aiConfig);

        const cascadeMsg = depth === 0
          ? `CASCADE TRIGGER: ${triggerContext}`
          : `CASCADE PROPAGATION (depth ${depth}): A change is propagating through the workflow. ${triggerContext}. How does this affect you?`;

        const response = await agent.think(cascadeMsg);
        return response;
      });

      const batchResults = await Promise.allSettled(batchPromises);
      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        }
      }
    }

    return results;
  }

  /**
   * Build a human-readable description of the trigger for agent context.
   */
  private buildTriggerContext(trigger: CascadeTrigger, depth: number): string {
    const base = trigger.description || '';

    switch (trigger.type) {
      case 'remove_edge':
        return `The edge from "${trigger.sourceId}" to "${trigger.targetId}" has been removed. ${base}`;
      case 'add_edge':
        return `A new edge from "${trigger.sourceId}" to "${trigger.targetId}" has been added. ${base}`;
      case 'remove_node':
        return `Node "${trigger.nodeId}" has been removed from the workflow. ${base}`;
      case 'bottleneck_resolve':
        return `The bottleneck at node "${trigger.nodeId}" is being resolved. ${base}`;
      default:
        return base;
    }
  }

  /**
   * Collect all edges (core + custom) for the message broker.
   */
  private collectEdges(): Array<{ source: string; target: string }> {
    const edges: Array<{ source: string; target: string }> = [];

    for (const edgeId of Object.keys(EDGE_DATA)) {
      const hyphen = edgeId.indexOf('-');
      if (hyphen === -1) continue;
      edges.push({
        source: edgeId.slice(0, hyphen),
        target: edgeId.slice(hyphen + 1),
      });
    }

    for (const edge of this.state.customEdges) {
      if (!edge.isImprovementOnly) {
        edges.push({ source: edge.source, target: edge.target });
      }
    }

    return edges;
  }
}
