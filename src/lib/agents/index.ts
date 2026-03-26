/**
 * agents/index.ts — Public API for the distributed agent system.
 */

// Types
export type {
  AgentContext,
  AgentMessage,
  AgentMessageType,
  AgentAction,
  AgentActionType,
  AgentResponse,
  OrchestratorResult,
  SimulationPayload,
  SimulationResult,
  SimulationStep,
  CascadeTrigger,
  CascadeTriggerType,
  CascadeStep,
  CascadeResult,
  GroupContext,
  GroupAnalysis,
  GroupNegotiation,
} from './types';

// Builders
export { buildAgentContext, buildGroupContext } from './contextBuilder';

// Agents
export { NodeAgent } from './nodeAgent';
export { GroupAgent } from './groupAgent';

// Orchestration
export { AgentOrchestrator } from './orchestrator';

// Messaging
export { MessageBroker, MAX_CASCADE_DEPTH, MAX_MESSAGES_PER_SIMULATION } from './messageBroker';

// Cascade
export { CascadeSimulator } from './cascadeSimulator';
