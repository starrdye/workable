/**
 * agents/adapters.ts — Convert distributed agent results into monolithic response shapes.
 *
 * The UI components (AIAnalysisModal, AIUpdateModal) consume specific response
 * shapes defined by the monolithic routes. These adapters bridge the gap so the
 * Strategy pattern works: the UI never needs to know which engine produced the data.
 */

import type {
  OrchestratorResult,
  AgentResponse,
  GroupAnalysis,
  CascadeResult,
  AgentAction,
} from './types';

// ── Optimize Response Shape (matches /api/ai/optimize output) ────────────────

export interface OptimizeResponse {
  analysis: string;
  suggestedConnections: SuggestedConnectionShape[];
  suggestedEdgeRemovals: SuggestedEdgeRemovalShape[];
  suggestedRemovals: SuggestedRemovalShape[];
  suggestedNewNodes: SuggestedNewNodeShape[];
  suggestedTaskUpdates: SuggestedTaskUpdateShape[];
  suggestedGroupUpdates: SuggestedGroupUpdateShape[];
  suggestionPlan: { phases: SuggestionPhaseShape[] } | null;
}

interface SuggestedConnectionShape {
  sourceId: string;
  sourceName: string;
  targetId: string;
  targetName: string;
  connectionName: string;
  connectionType: 'optimised';
  reason: string;
  cascadeEffects: Array<{
    id: string;
    type: 'orphan' | 'bottleneck' | 'redundant-edge' | 'stable';
    description: string;
    depth: number;
  }>;
}

interface SuggestedEdgeRemovalShape {
  edgeId: string;
  sourceName: string;
  targetName: string;
  reason: string;
  prerequisiteConnectionId?: string;
}

interface SuggestedRemovalShape {
  type: 'node';
  id: string;
  name: string;
  action: 'remove' | 'automate' | 'merge';
  reason: string;
  mergeTargetId?: string;
  fishboneBones: Array<{
    category: string;
    cause: string;
    resolvedBy?: { type: string; refId: string };
  }>;
}

interface SuggestedNewNodeShape {
  tempId: string;
  label: string;
  role: string;
  summary: string;
  connectFrom: string[];
  connectTo: string[];
  replacesNodeId?: string;
}

interface SuggestedTaskUpdateShape {
  nodeId: string;
  nodeName: string;
  addTasks: Array<{ id: string; title: string; status: string; priority: string }>;
  removeTasks: string[];
  reason: string;
}

interface SuggestedGroupUpdateShape {
  action: 'create' | 'update' | 'delete';
  groupId?: string;
  tempId?: string;
  name?: string;
  color?: string;
  nodeIds?: string[];
  addNodeIds?: string[];
  removeNodeIds?: string[];
  currentName?: string;
  reason: string;
}

interface SuggestionPhaseShape {
  phaseIndex: number;
  label: string;
  description: string;
  prerequisitePhases: number[];
  suggestionRefs: Array<{ type: string; refId: string }>;
}

// ── Adapter: OrchestratorResult → OptimizeResponse ───────────────────────────

export function orchestratorResultToOptimizeResponse(
  orchestratorResult: OrchestratorResult,
  groupAnalyses: GroupAnalysis[] = [],
  cascadeResult?: CascadeResult,
): OptimizeResponse {
  const { responses, bottlenecks, proposedEdges, orphanWarnings, conflicts } = orchestratorResult;

  // ── 1. Build analysis markdown ────────────────────────────────────────────
  const analysisLines: string[] = [];

  analysisLines.push('## Workflow Summary');
  analysisLines.push(`- Analysed ${responses.length} nodes using distributed per-node agents`);
  analysisLines.push(`- Total tokens: ${orchestratorResult.totalTokens.input + orchestratorResult.totalTokens.output} (${orchestratorResult.wallTimeMs}ms wall time)`);
  if (groupAnalyses.length > 0) {
    analysisLines.push(`- ${groupAnalyses.length} group-level analyses completed`);
  }
  analysisLines.push('');

  if (bottlenecks.length > 0) {
    analysisLines.push('## Bottlenecks Identified');
    for (const b of bottlenecks) {
      analysisLines.push(`- **${b.nodeName}**: ${b.reason}`);
    }
    analysisLines.push('');
  }

  if (orphanWarnings.length > 0) {
    analysisLines.push('## Orphan Warnings');
    for (const o of orphanWarnings) {
      analysisLines.push(`- **${o.nodeName}**: ${o.reason}`);
    }
    analysisLines.push('');
  }

  if (conflicts.length > 0) {
    analysisLines.push('## Conflicts Detected');
    for (const c of conflicts) {
      analysisLines.push(`- Between agents ${c.agentA} and ${c.agentB}: ${c.description}`);
    }
    analysisLines.push('');
  }

  // Per-node analysis summaries — full text, display layer handles expansion
  analysisLines.push('## Per-Node Analysis');
  for (const resp of responses) {
    analysisLines.push(`- **${resp.nodeName}**: ${resp.analysis}`);
  }

  // Group analyses — full text
  if (groupAnalyses.length > 0) {
    analysisLines.push('');
    analysisLines.push('## Group Analysis');
    for (const ga of groupAnalyses) {
      analysisLines.push(`- **${ga.groupName}**: ${ga.analysis}`);
    }
  }

  // ── 2. Build suggested connections ────────────────────────────────────────
  const suggestedConnections: SuggestedConnectionShape[] = proposedEdges.map(pe => ({
    sourceId: pe.source,
    sourceName: findNodeName(responses, pe.source),
    targetId: pe.target,
    targetName: findNodeName(responses, pe.target),
    connectionName: `Agent-proposed: ${pe.source} → ${pe.target}`,
    connectionType: 'optimised' as const,
    reason: pe.reason,
    cascadeEffects: cascadeResult
      ? cascadeResult.steps
          .filter(s => s.nodeId === pe.target || s.nodeId === pe.source)
          .map(s => ({
            id: s.nodeId,
            type: 'stable' as const,
            description: s.reaction.slice(0, 200),
            depth: s.depth,
          }))
      : [{ id: 'none', type: 'stable' as const, description: 'No cascade analysis performed', depth: 1 }],
  }));

  // ── 3. Build suggested edge removals ──────────────────────────────────────
  const suggestedEdgeRemovals: SuggestedEdgeRemovalShape[] = [];
  for (const resp of responses) {
    for (const action of resp.suggestedActions) {
      if (action.type === 'remove_edge' && action.edgeId) {
        suggestedEdgeRemovals.push({
          edgeId: action.edgeId,
          sourceName: resp.nodeName,
          targetName: action.targetNodeId ?? 'unknown',
          reason: action.reason,
        });
      }
    }
  }

  // ── 4. Build suggested removals (from orphan warnings + bottleneck flags) ─
  const suggestedRemovals: SuggestedRemovalShape[] = [];
  for (const resp of responses) {
    for (const action of resp.suggestedActions) {
      if (action.type === 'delegate_task' && action.targetNodeId) {
        // delegate_task with a target suggests the current node should be automated
        suggestedRemovals.push({
          type: 'node',
          id: resp.nodeId,
          name: resp.nodeName,
          action: 'automate',
          reason: action.reason,
          fishboneBones: [{
            category: 'Process',
            cause: action.reason,
          }],
        });
      }
    }
  }

  // ── 5. Suggested new nodes (from propose_optimization actions) ────────────
  const suggestedNewNodes: SuggestedNewNodeShape[] = [];
  let newNodeCounter = 0;
  for (const resp of responses) {
    for (const action of resp.suggestedActions) {
      if (action.type === 'propose_optimization' && action.description.toLowerCase().includes('node')) {
        newNodeCounter++;
        suggestedNewNodes.push({
          tempId: `dist_new_${newNodeCounter}`,
          label: action.description.slice(0, 40),
          role: 'tool',
          summary: action.reason,
          connectFrom: [resp.nodeId],
          connectTo: [],
        });
      }
    }
  }

  // ── 6. Task updates (from delegate_task actions) ──────────────────────────
  const suggestedTaskUpdates: SuggestedTaskUpdateShape[] = [];
  for (const resp of responses) {
    for (const action of resp.suggestedActions) {
      if (action.type === 'delegate_task' && action.targetNodeId) {
        suggestedTaskUpdates.push({
          nodeId: action.targetNodeId,
          nodeName: findNodeName(responses, action.targetNodeId),
          addTasks: [{
            id: `t_dist_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            title: action.description,
            status: 'todo',
            priority: 'medium',
          }],
          removeTasks: [],
          reason: action.reason,
        });
      }
    }
  }

  // ── 7. Group updates (from GroupAnalysis boundary proposals) ───────────────
  const suggestedGroupUpdates: SuggestedGroupUpdateShape[] = [];
  for (const ga of groupAnalyses) {
    for (const bp of ga.boundaryProposals) {
      if (bp.proposalType === 'move_node') {
        suggestedGroupUpdates.push({
          action: 'update',
          groupId: bp.targetGroupId,
          addNodeIds: bp.affectedNodeIds,
          reason: bp.reason,
        });
      }
    }

    for (const opt of ga.internalOptimizations) {
      if (opt.type === 'propose_optimization') {
        suggestedGroupUpdates.push({
          action: 'update',
          groupId: ga.groupId,
          currentName: ga.groupName,
          reason: opt.reason,
        });
      }
    }
  }

  // ── 8. Suggestion plan ────────────────────────────────────────────────────
  const phases: SuggestionPhaseShape[] = [];
  let phaseIdx = 1;

  if (suggestedConnections.length > 0) {
    phases.push({
      phaseIndex: phaseIdx++,
      label: 'Add Optimised Connections',
      description: `Add ${suggestedConnections.length} agent-recommended connections`,
      prerequisitePhases: [],
      suggestionRefs: suggestedConnections.map(c => ({
        type: 'connection',
        refId: `${c.sourceId}-${c.targetId}`,
      })),
    });
  }

  if (suggestedEdgeRemovals.length > 0) {
    phases.push({
      phaseIndex: phaseIdx++,
      label: 'Remove Redundant Edges',
      description: `Remove ${suggestedEdgeRemovals.length} edges flagged by agents`,
      prerequisitePhases: phases.length > 0 ? [1] : [],
      suggestionRefs: suggestedEdgeRemovals.map(r => ({
        type: 'edgeRemoval',
        refId: r.edgeId,
      })),
    });
  }

  if (suggestedRemovals.length > 0 || suggestedNewNodes.length > 0) {
    phases.push({
      phaseIndex: phaseIdx++,
      label: 'Restructure Nodes',
      description: `Process ${suggestedRemovals.length} removals and ${suggestedNewNodes.length} new nodes`,
      prerequisitePhases: phases.length > 0 ? [phases.length] : [],
      suggestionRefs: [
        ...suggestedRemovals.map(r => ({ type: 'removal' as const, refId: r.id })),
        ...suggestedNewNodes.map(n => ({ type: 'newNode' as const, refId: n.tempId })),
      ],
    });
  }

  return {
    analysis: analysisLines.join('\n'),
    suggestedConnections,
    suggestedEdgeRemovals,
    suggestedRemovals,
    suggestedNewNodes,
    suggestedTaskUpdates,
    suggestedGroupUpdates,
    suggestionPlan: phases.length > 0 ? { phases } : null,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function findNodeName(responses: AgentResponse[], nodeId: string): string {
  const resp = responses.find(r => r.nodeId === nodeId);
  return resp?.nodeName ?? nodeId;
}

// ── Update Response Adapter ──────────────────────────────────────────────────

/**
 * Build a lightweight node list for the coordinator agent.
 * ~20 tokens per node — keeps the coordinator prompt small.
 */
export function buildCoordinatorNodeList(
  nodes: Array<{ id: string; name: string; role: string }>,
  edges: Array<{ id: string; source: string; target: string; name?: string }>,
): string {
  const lines: string[] = ['NODES:'];
  for (const n of nodes) {
    lines.push(`  [${n.id}] ${n.name} (${n.role})`);
  }
  lines.push('');
  lines.push('EDGES:');
  for (const e of edges) {
    lines.push(`  [${e.id}] ${e.source} → ${e.target}${e.name ? ` "${e.name}"` : ''}`);
  }
  return lines.join('\n');
}
