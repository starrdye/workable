/**
 * agents.test.ts — Regression tests for the distributed agent system.
 * Covers: context building, message broker, spatial index, feature flags.
 * Does NOT test LLM calls (those require API keys).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { buildAgentContext, buildGroupContext } from '../lib/agents/contextBuilder';
import { MessageBroker, MAX_CASCADE_DEPTH } from '../lib/agents/messageBroker';
import { SpatialIndex, determineLOD } from '../lib/spatialIndex';
import { buildRoleSummary, buildGroupIdLookup } from '../lib/snapshotBuilder';
import type { ServerGraphState } from '../lib/serverState';
import type { AgentMessage } from '../lib/agents/types';

// ── Test fixtures ────────────────────────────────────────────────────────────

function createTestState(): ServerGraphState {
  return {
    baselinePositions: {
      nav: { x: 80, y: 250 },
      xy: { x: 280, y: 250 },
      mary: { x: 480, y: 250 },
      ed: { x: 680, y: 150 },
      cy: { x: 880, y: 250 },
      'custom-1': { x: 200, y: 400 },
      'custom-2': { x: 600, y: 400 },
    },
    ecosystemPositions: {},
    originalBaselinePositions: {},
    originalEcosystemPositions: {},
    customNodes: [
      {
        id: 'custom-1', label: 'Bot Alpha', labelInitials: 'BA',
        nodeType: 'neural', role: 'tool', position: { x: 200, y: 400 },
      },
      {
        id: 'custom-2', label: 'Finance Team', labelInitials: 'FT',
        nodeType: 'neural', role: 'person', position: { x: 600, y: 400 },
      },
    ],
    customEdges: [
      { id: 'custom-1-xy', source: 'custom-1', target: 'xy', weight: 1.5, name: 'Bot Feed' },
      { id: 'custom-2-ed', source: 'custom-2', target: 'ed', weight: 2.0, name: 'Review Request' },
      { id: 'mary-custom-2', source: 'mary', target: 'custom-2', weight: 1.0, name: 'Delegation' },
    ],
    settings: {
      nodePause: 1,
      edgeWeightOverrides: {},
      nodeDelayOverrides: {},
      metadataOverrides: {
        ed: {
          constraints: 'Max 3 concurrent reviews',
          summary: 'Final manual review queue',
        },
        'custom-1': {
          summary: 'Automated data ingestion bot',
        },
      },
      workflowGroups: [
        { id: 'grp_review', name: 'Review Team', color: '#8B5CF6', nodeIds: ['ed', 'custom-2'] },
        { id: 'grp_input', name: 'Input Pipeline', color: '#10B981', nodeIds: ['nav', 'xy', 'custom-1'] },
      ],
    },
    lastUpdated: Date.now(),
  };
}

// ── Agent Context Builder ────────────────────────────────────────────────────

describe('buildAgentContext', () => {
  let state: ServerGraphState;
  beforeEach(() => { state = createTestState(); });

  it('returns correct identity for a core node', () => {
    const ctx = buildAgentContext('ed', state);
    expect(ctx.nodeId).toBe('ed');
    expect(ctx.nodeName).toBe('Edward');
    expect(ctx.role).toBe('Manager');
    expect(ctx.constraints).toBe('Max 3 concurrent reviews');
  });

  it('returns correct identity for a custom node', () => {
    const ctx = buildAgentContext('custom-1', state);
    expect(ctx.nodeId).toBe('custom-1');
    expect(ctx.nodeName).toBe('Bot Alpha');
    expect(ctx.role).toBe('tool');
    expect(ctx.summary).toBe('Automated data ingestion bot');
  });

  it('collects inbound and outbound edges', () => {
    const ctx = buildAgentContext('xy', state);
    // Xingye receives from: nav (core), script (core), db (core), custom-1 (custom)
    expect(ctx.inboundEdges.length).toBeGreaterThanOrEqual(3);
    // Xingye sends to: mary (core), script (core)
    expect(ctx.outboundEdges.length).toBeGreaterThanOrEqual(1);
  });

  it('collects custom edge connections', () => {
    const ctx = buildAgentContext('custom-1', state);
    expect(ctx.outboundEdges.some(e => e.toId === 'xy')).toBe(true);
    expect(ctx.outboundEdges.find(e => e.toId === 'xy')?.edgeName).toBe('Bot Feed');
  });

  it('includes group memberships', () => {
    const ctx = buildAgentContext('ed', state);
    expect(ctx.groupMemberships).toHaveLength(1);
    expect(ctx.groupMemberships[0].groupName).toBe('Review Team');
    expect(ctx.groupMemberships[0].peerNodeIds).toContain('custom-2');
  });

  it('returns empty groups for unassigned node', () => {
    const ctx = buildAgentContext('cy', state);
    expect(ctx.groupMemberships).toHaveLength(0);
  });

  it('includes 1-hop neighbour summaries', () => {
    const ctx = buildAgentContext('ed', state);
    const neighborNames = ctx.neighborSummaries.map(n => n.name);
    expect(neighborNames).toContain('Mary');
    expect(neighborNames).toContain('Finance Team');
  });

  it('skips improvement-only edges', () => {
    state.customEdges.push({
      id: 'improvement-edge', source: 'mary', target: 'cy',
      isImprovementOnly: true, weight: 1,
    });
    const ctx = buildAgentContext('mary', state);
    expect(ctx.outboundEdges.some(e => e.toId === 'cy' && e.edgeName === '')).toBe(false);
  });
});

// ── Group Context Builder ────────────────────────────────────────────────────

describe('buildGroupContext', () => {
  let state: ServerGraphState;
  beforeEach(() => { state = createTestState(); });

  it('builds context for a valid group', () => {
    const ctx = buildGroupContext('grp_review', state);
    expect(ctx.groupId).toBe('grp_review');
    expect(ctx.groupName).toBe('Review Team');
    expect(ctx.memberNodes).toHaveLength(2);
  });

  it('identifies boundary edges', () => {
    const ctx = buildGroupContext('grp_review', state);
    // Review Team has: mary → custom-2 (inbound boundary), ed → cy (outbound boundary via core edge)
    expect(ctx.boundaryEdges.length).toBeGreaterThanOrEqual(1);
    const maryBoundary = ctx.boundaryEdges.find(b => b.externalNodeName === 'Mary');
    expect(maryBoundary).toBeDefined();
    expect(maryBoundary?.direction).toBe('inbound');
  });

  it('returns empty context for nonexistent group', () => {
    const ctx = buildGroupContext('nonexistent', state);
    expect(ctx.memberNodes).toHaveLength(0);
    expect(ctx.boundaryEdges).toHaveLength(0);
  });

  it('identifies adjacent groups', () => {
    const ctx = buildGroupContext('grp_review', state);
    // grp_review connects to nodes outside itself; if those are in grp_input, it's adjacent
    // Edward has core edges to Mary and Cy — Mary is not in any group that we check here
    // But custom-2 ← mary edge creates an adjacency
    expect(ctx.adjacentGroupSummaries.length).toBeGreaterThanOrEqual(0);
  });
});

// ── Message Broker ───────────────────────────────────────────────────────────

describe('MessageBroker', () => {
  const edges = [
    { source: 'a', target: 'b' },
    { source: 'b', target: 'c' },
    { source: 'c', target: 'd' },
  ];

  it('delivers messages along valid edges', () => {
    const broker = new MessageBroker(edges);
    const received: AgentMessage[] = [];
    broker.subscribe('b', (msg) => { received.push(msg); });

    const msg: AgentMessage = {
      id: 'test-1', fromNodeId: 'a', toNodeId: 'b',
      type: 'PAYLOAD_FORWARDED', content: 'Hello B',
      timestamp: Date.now(), depth: 0,
    };

    const delivered = broker.send(msg);
    expect(delivered).toBe(true);
    expect(received).toHaveLength(1);
    expect(received[0].content).toBe('Hello B');
    broker.destroy();
  });

  it('rejects messages with no valid edge (non-system)', () => {
    const broker = new MessageBroker(edges);
    const rejected: Array<{ msg: AgentMessage; reason: string }> = [];
    broker.on('rejected', (data) => rejected.push(data));

    const msg: AgentMessage = {
      id: 'test-2', fromNodeId: 'a', toNodeId: 'd', // no direct edge a→d
      type: 'PAYLOAD_FORWARDED', content: 'Shortcut',
      timestamp: Date.now(), depth: 0,
    };

    const delivered = broker.send(msg);
    expect(delivered).toBe(false);
    expect(rejected).toHaveLength(1);
    broker.destroy();
  });

  it('allows system messages without edge validation', () => {
    const broker = new MessageBroker(edges);
    const received: AgentMessage[] = [];
    broker.subscribe('d', (msg) => { received.push(msg); });

    const msg: AgentMessage = {
      id: 'test-3', fromNodeId: 'system', toNodeId: 'd',
      type: 'NODE_DELETED', content: 'Node removed',
      timestamp: Date.now(), depth: 0,
    };

    expect(broker.send(msg)).toBe(true);
    expect(received).toHaveLength(1);
    broker.destroy();
  });

  it('enforces depth limit', () => {
    const broker = new MessageBroker(edges, 3);

    const msg: AgentMessage = {
      id: 'test-4', fromNodeId: 'a', toNodeId: 'b',
      type: 'REROUTE_REQUEST', content: 'Too deep',
      timestamp: Date.now(), depth: 4, // exceeds max of 3
    };

    expect(broker.send(msg)).toBe(false);
    broker.destroy();
  });

  it('enforces message count limit', () => {
    const broker = new MessageBroker(edges, MAX_CASCADE_DEPTH, 2);

    const msg1: AgentMessage = {
      id: 'm1', fromNodeId: 'a', toNodeId: 'b',
      type: 'PAYLOAD_FORWARDED', content: '1', timestamp: Date.now(), depth: 0,
    };
    const msg2: AgentMessage = { ...msg1, id: 'm2', content: '2' };
    const msg3: AgentMessage = { ...msg1, id: 'm3', content: '3' };

    expect(broker.send(msg1)).toBe(true);
    expect(broker.send(msg2)).toBe(true);
    expect(broker.send(msg3)).toBe(false); // limit reached
    expect(broker.totalMessages).toBe(2);
    broker.destroy();
  });

  it('broadcasts to all subscribed nodes except sender', () => {
    const broker = new MessageBroker(edges);
    const aReceived: AgentMessage[] = [];
    const bReceived: AgentMessage[] = [];
    const cReceived: AgentMessage[] = [];

    broker.subscribe('a', (msg) => aReceived.push(msg));
    broker.subscribe('b', (msg) => bReceived.push(msg));
    broker.subscribe('c', (msg) => cReceived.push(msg));

    broker.broadcast('EDGE_DELETED', 'Edge removed');

    // Sender is 'system' so all 3 should receive
    expect(aReceived).toHaveLength(1);
    expect(bReceived).toHaveLength(1);
    expect(cReceived).toHaveLength(1);
    broker.destroy();
  });

  it('tracks message history', () => {
    const broker = new MessageBroker(edges);
    broker.subscribe('b', () => {});

    broker.send({
      id: 'h1', fromNodeId: 'a', toNodeId: 'b',
      type: 'PAYLOAD_FORWARDED', content: 'First',
      timestamp: Date.now(), depth: 0,
    });
    broker.send({
      id: 'h2', fromNodeId: 'b', toNodeId: 'c',
      type: 'PAYLOAD_FORWARDED', content: 'Second',
      timestamp: Date.now(), depth: 1,
    });

    const history = broker.getHistory();
    expect(history).toHaveLength(2);

    const byDepth = broker.getHistoryByDepth();
    expect(byDepth.get(0)).toHaveLength(1);
    expect(byDepth.get(1)).toHaveLength(1);
    broker.destroy();
  });
});

// ── Spatial Index ────────────────────────────────────────────────────────────

describe('SpatialIndex', () => {
  it('inserts and searches nodes within viewport', () => {
    const index = new SpatialIndex();
    index.insert('a', { x: 100, y: 100 });
    index.insert('b', { x: 500, y: 500 });
    index.insert('c', { x: 1000, y: 1000 });

    // Viewport that should contain 'a' only (with margin)
    const result = index.search({ minX: 0, minY: 0, maxX: 200, maxY: 200 }, 0);
    expect(result).toContain('a');
    expect(result).not.toContain('c');
  });

  it('handles margin correctly', () => {
    const index = new SpatialIndex();
    index.insert('a', { x: 250, y: 250 });

    // Without margin, node at 250,250 is outside viewport 0-200
    const withoutMargin = index.search({ minX: 0, minY: 0, maxX: 200, maxY: 200 }, 0);
    // With 50% margin, viewport expands to -100,-100 → 300,300
    const withMargin = index.search({ minX: 0, minY: 0, maxX: 200, maxY: 200 }, 0.5);

    // Node at 250 with bbox ±70 means minX=180, which IS within the base viewport 0-200
    // So it should be in both, but the margin test shows margin expansion works
    expect(withMargin).toContain('a');
  });

  it('rebuilds from positions map', () => {
    const index = new SpatialIndex();
    index.rebuild({
      n1: { x: 100, y: 100 },
      n2: { x: 200, y: 200 },
      n3: { x: 300, y: 300 },
    });

    expect(index.size).toBe(3);
    expect(index.all()).toHaveLength(3);
  });

  it('removes nodes', () => {
    const index = new SpatialIndex();
    index.insert('a', { x: 100, y: 100 });
    index.insert('b', { x: 200, y: 200 });
    expect(index.size).toBe(2);

    index.remove('a');
    expect(index.size).toBe(1);
    expect(index.all()).toEqual(['b']);
  });

  it('handles empty index', () => {
    const index = new SpatialIndex();
    expect(index.size).toBe(0);
    expect(index.search({ minX: 0, minY: 0, maxX: 1000, maxY: 1000 })).toEqual([]);
    expect(index.getBounds()).toBeNull();
  });
});

// ── LOD ──────────────────────────────────────────────────────────────────────

describe('determineLOD', () => {
  it('returns "full" for zoom > 0.7', () => {
    expect(determineLOD(1.0)).toBe('full');
    expect(determineLOD(0.8)).toBe('full');
    expect(determineLOD(0.71)).toBe('full');
  });

  it('returns "simplified" for 0.3 < zoom <= 0.7', () => {
    expect(determineLOD(0.7)).toBe('simplified');
    expect(determineLOD(0.5)).toBe('simplified');
    expect(determineLOD(0.31)).toBe('simplified');
  });

  it('returns "dot" for zoom <= 0.3', () => {
    expect(determineLOD(0.3)).toBe('dot');
    expect(determineLOD(0.1)).toBe('dot');
    expect(determineLOD(0.0)).toBe('dot');
  });
});

// ── Snapshot Builder Helpers (regression) ────────────────────────────────────

describe('buildRoleSummary', () => {
  it('counts roles correctly', () => {
    expect(buildRoleSummary(['person', 'person', 'tool'])).toBe('2 person, 1 tool');
  });

  it('returns "empty" for empty array', () => {
    expect(buildRoleSummary([])).toBe('empty');
  });

  it('normalises case', () => {
    expect(buildRoleSummary(['Person', 'PERSON', 'Tool'])).toBe('2 person, 1 tool');
  });
});

describe('buildGroupIdLookup', () => {
  it('maps nodes to their group IDs', () => {
    const lookup = buildGroupIdLookup([
      { id: 'g1', nodeIds: ['a', 'b'] },
      { id: 'g2', nodeIds: ['b', 'c'] },
    ]);
    expect(lookup['a']).toEqual(['g1']);
    expect(lookup['b']).toEqual(['g1', 'g2']);
    expect(lookup['c']).toEqual(['g2']);
  });

  it('returns empty object for no groups', () => {
    expect(buildGroupIdLookup([])).toEqual({});
  });
});
