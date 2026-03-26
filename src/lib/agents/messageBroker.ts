/**
 * agents/messageBroker.ts — In-process message broker for agent cascade simulation.
 * Phase 3: Message passing & organic cascades.
 *
 * Replaces the current Pass 2 cascade validation (where one LLM predicts all
 * downstream effects) with emergent cascades through agent message passing.
 * Each broker instance is scoped to a single simulation run.
 */

import { EventEmitter } from 'events';
import type { AgentMessage, AgentMessageType } from './types';

export const MAX_CASCADE_DEPTH = 5;
export const MAX_MESSAGES_PER_SIMULATION = 100;

export class MessageBroker extends EventEmitter {
  private history: AgentMessage[] = [];
  private messageCount = 0;
  /** Set of valid edges: "sourceId->targetId" */
  private validEdges = new Set<string>();
  /** Node IDs that have subscribed handlers */
  private subscribedNodes = new Set<string>();

  constructor(
    edges: Array<{ source: string; target: string }>,
    private readonly maxDepth = MAX_CASCADE_DEPTH,
    private readonly maxMessages = MAX_MESSAGES_PER_SIMULATION,
  ) {
    super();
    // Index valid edges for routing validation
    for (const e of edges) {
      this.validEdges.add(`${e.source}->${e.target}`);
      // Also allow reverse direction for bidirectional communication
      this.validEdges.add(`${e.target}->${e.source}`);
    }
  }

  /**
   * Subscribe a node agent to receive messages.
   */
  subscribe(nodeId: string, handler: (msg: AgentMessage) => void | Promise<void>): void {
    this.subscribedNodes.add(nodeId);
    this.on(`message:${nodeId}`, handler);
  }

  /**
   * Unsubscribe a node agent.
   */
  unsubscribe(nodeId: string): void {
    this.subscribedNodes.delete(nodeId);
    this.removeAllListeners(`message:${nodeId}`);
  }

  /**
   * Send a message from one agent to another.
   * Validates: edge exists, depth limit, message count limit.
   * Returns true if the message was delivered, false if rejected.
   */
  send(msg: AgentMessage): boolean {
    // Depth check
    if (msg.depth > this.maxDepth) {
      this.emit('rejected', { msg, reason: `Depth ${msg.depth} exceeds max ${this.maxDepth}` });
      return false;
    }

    // Message count limit (prevent runaway simulations)
    if (this.messageCount >= this.maxMessages) {
      this.emit('rejected', { msg, reason: `Message limit ${this.maxMessages} reached` });
      return false;
    }

    // Broadcasts skip edge validation
    if (msg.toNodeId === 'broadcast') {
      this.messageCount++;
      this.history.push(msg);
      // Deliver to all subscribed nodes except sender
      for (const nodeId of this.subscribedNodes) {
        if (nodeId !== msg.fromNodeId) {
          this.emit(`message:${nodeId}`, { ...msg, toNodeId: nodeId });
        }
      }
      this.emit('delivered', msg);
      return true;
    }

    // Targeted message — validate edge exists (or it's a system message)
    const isSystemMessage = msg.fromNodeId === 'system';
    const hasEdge = this.validEdges.has(`${msg.fromNodeId}->${msg.toNodeId}`);

    if (!isSystemMessage && !hasEdge) {
      this.emit('rejected', { msg, reason: `No edge between ${msg.fromNodeId} and ${msg.toNodeId}` });
      return false;
    }

    // Deliver
    this.messageCount++;
    this.history.push(msg);
    this.emit(`message:${msg.toNodeId}`, msg);
    this.emit('delivered', msg);
    return true;
  }

  /**
   * Broadcast a system message to all subscribed nodes.
   */
  broadcast(type: AgentMessageType, content: string, payload?: Record<string, unknown>): void {
    const msg: AgentMessage = {
      id: `system-broadcast-${Date.now()}`,
      fromNodeId: 'system',
      toNodeId: 'broadcast',
      type,
      content,
      payload,
      timestamp: Date.now(),
      depth: 0,
    };
    this.send(msg);
  }

  /**
   * Get the full message history for this simulation.
   */
  getHistory(): AgentMessage[] {
    return [...this.history];
  }

  /**
   * Get messages grouped by depth level (for visualisation).
   */
  getHistoryByDepth(): Map<number, AgentMessage[]> {
    const byDepth = new Map<number, AgentMessage[]>();
    for (const msg of this.history) {
      if (!byDepth.has(msg.depth)) byDepth.set(msg.depth, []);
      byDepth.get(msg.depth)!.push(msg);
    }
    return byDepth;
  }

  /**
   * Total messages processed in this simulation.
   */
  get totalMessages(): number {
    return this.messageCount;
  }

  /**
   * Clean up all listeners.
   */
  destroy(): void {
    this.removeAllListeners();
    this.history = [];
    this.subscribedNodes.clear();
  }
}
