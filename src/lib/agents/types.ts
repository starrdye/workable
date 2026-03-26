/**
 * agents/types.ts — Type definitions for the distributed agent system.
 * Phase 2: Node-as-an-Agent architecture.
 */

import type { NodeTask } from '../serverState';

// ── Agent Context (ego-centric view) ─────────────────────────────────────────

export interface AgentContext {
  nodeId: string;
  nodeName: string;
  role: string;
  summary: string;
  constraints?: string;
  tasks: NodeTask[];
  inboundEdges: Array<{ fromId: string; fromName: string; edgeName: string; weight: number }>;
  outboundEdges: Array<{ toId: string; toName: string; edgeName: string; weight: number }>;
  groupMemberships: Array<{ groupId: string; groupName: string; peerNodeIds: string[] }>;
  neighborSummaries: Array<{ id: string; name: string; role: string; summary: string }>;
}

// ── Agent Messages (Phase 3) ─────────────────────────────────────────────────

export type AgentMessageType =
  | 'EDGE_DELETED'
  | 'NODE_DELETED'
  | 'PAYLOAD_FORWARDED'
  | 'BOTTLENECK_DETECTED'
  | 'ORPHAN_WARNING'
  | 'NEW_EDGE_PROPOSED'
  | 'EDGE_ACCEPTED'
  | 'EDGE_REJECTED'
  | 'REROUTE_REQUEST'
  | 'SIMULATION_COMPLETE';

export interface AgentMessage {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  type: AgentMessageType;
  content: string;
  payload?: Record<string, unknown>;
  timestamp: number;
  depth: number;           // cascade depth counter — broker refuses depth > MAX_DEPTH
}

// ── Agent Actions ────────────────────────────────────────────────────────────

export type AgentActionType =
  | 'add_edge'
  | 'remove_edge'
  | 'flag_bottleneck'
  | 'flag_orphan'
  | 'delegate_task'
  | 'propose_optimization'
  | 'no_action';

export interface AgentAction {
  type: AgentActionType;
  description: string;
  targetNodeId?: string;
  edgeId?: string;
  reason: string;
}

// ── Agent Response ───────────────────────────────────────────────────────────

export interface AgentResponse {
  nodeId: string;
  nodeName: string;
  analysis: string;
  suggestedActions: AgentAction[];
  messagesOut: AgentMessage[];
  tokenUsage?: { input: number; output: number };
}

// ── Orchestrator Result ──────────────────────────────────────────────────────

export interface OrchestratorResult {
  responses: AgentResponse[];
  bottlenecks: Array<{ nodeId: string; nodeName: string; reason: string }>;
  proposedEdges: Array<{ source: string; target: string; reason: string }>;
  orphanWarnings: Array<{ nodeId: string; nodeName: string; reason: string }>;
  conflicts: Array<{ agentA: string; agentB: string; description: string }>;
  totalTokens: { input: number; output: number };
  wallTimeMs: number;
}

// ── Simulation Types ─────────────────────────────────────────────────────────

export interface SimulationPayload {
  id: string;
  type: string;
  description: string;
  startNodeId: string;
  arrivalTime: number;
  queueDepth: number;
}

export interface SimulationStep {
  nodeId: string;
  nodeName: string;
  action: string;
  processingTime: number;
  forwardTo: string | null;
  isBlocked: boolean;
  reason: string;
}

export interface SimulationResult {
  payload: SimulationPayload;
  steps: SimulationStep[];
  totalTime: number;
  bottleneckNodeId: string | null;
}

// ── Cascade Types (Phase 3) ──────────────────────────────────────────────────

export type CascadeTriggerType =
  | 'add_edge'
  | 'remove_edge'
  | 'remove_node'
  | 'bottleneck_resolve';

export interface CascadeTrigger {
  type: CascadeTriggerType;
  sourceId?: string;
  targetId?: string;
  edgeId?: string;
  nodeId?: string;
  description: string;
}

export interface CascadeStep {
  nodeId: string;
  nodeName: string;
  depth: number;
  reaction: string;
  propagatesTo: string[];
  suggestedActions: AgentAction[];
}

export interface CascadeResult {
  trigger: CascadeTrigger;
  steps: CascadeStep[];
  totalAgentCalls: number;
  totalTokens: { input: number; output: number };
  wallTimeMs: number;
}

// ── Group Agent Types (Phase 4) ──────────────────────────────────────────────

export interface GroupContext {
  groupId: string;
  groupName: string;
  color: string;
  memberNodes: AgentContext[];
  boundaryEdges: Array<{
    edgeId: string;
    internalNodeId: string;
    externalNodeId: string;
    externalNodeName: string;
    externalNodeRole: string;
    direction: 'inbound' | 'outbound';
  }>;
  subgroups: Array<{ id: string; name: string; nodeCount: number }>;
  parentGroup?: { id: string; name: string };
  adjacentGroupSummaries: Array<{
    groupId: string;
    groupName: string;
    nodeCount: number;
    edgeCount: number;
    roleSummary: string;
  }>;
}

export interface GroupAnalysis {
  groupId: string;
  groupName: string;
  analysis: string;
  internalOptimizations: AgentAction[];
  boundaryProposals: GroupNegotiation[];
  bottleneckNodes: string[];
  redundantEdges: string[];
  tokenUsage: { input: number; output: number };
}

export interface GroupNegotiation {
  proposingGroupId: string;
  targetGroupId: string;
  proposalType: 'add_edge' | 'remove_edge' | 'modify_edge' | 'move_node';
  description: string;
  affectedNodeIds: string[];
  reason: string;
  response?: {
    accepted: boolean;
    counterProposal?: string;
    reason: string;
  };
}
