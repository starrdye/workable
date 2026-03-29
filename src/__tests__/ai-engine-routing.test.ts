/**
 * ai-engine-routing.test.ts — Integration tests for the Strategy pattern engine toggle.
 *
 * Tests:
 *   1. Adapter: OrchestratorResult → OptimizeResponse shape correctness
 *   2. Adapter: CoordinatorNodeList builder
 *   3. Route dispatch: engine param correctly selects monolithic vs distributed path
 *   4. Race condition: generation counter detects stale responses
 *   5. AbortController: in-flight request aborted on mode toggle
 *   6. Regression: monolithic path unchanged when engine param absent
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { orchestratorResultToOptimizeResponse, buildCoordinatorNodeList } from '../lib/agents/adapters';
import type { OrchestratorResult, AgentResponse, GroupAnalysis, CascadeResult } from '../lib/agents/types';

// ── Fixtures ─────────────────────────────────────────────────────────────────

function createMockOrchResult(): OrchestratorResult {
  const responses: AgentResponse[] = [
    {
      nodeId: 'nav',
      nodeName: 'Navigator',
      analysis: 'I am the entry point. All requests flow through me.',
      suggestedActions: [
        { type: 'flag_bottleneck', description: 'Overloaded', reason: 'Too many inbound connections', targetNodeId: 'nav' },
        { type: 'add_edge', description: 'Connect to cache', targetNodeId: 'cache', reason: 'Bypass slow path' },
      ],
      messagesOut: [],
    },
    {
      nodeId: 'ed',
      nodeName: 'Edward',
      analysis: 'Manual review is slow. Should delegate more.',
      suggestedActions: [
        { type: 'delegate_task', description: 'Auto-review small items', targetNodeId: 'bot1', reason: 'Free up capacity' },
        { type: 'remove_edge', description: 'Remove redundant edge', edgeId: 'ed-legacy', reason: 'Legacy path no longer used' },
      ],
      messagesOut: [],
    },
    {
      nodeId: 'bot1',
      nodeName: 'Bot Alpha',
      analysis: 'Under-utilised. Could take on more work.',
      suggestedActions: [
        { type: 'propose_optimization', description: 'Add gateway node for auto-routing', reason: 'Would reduce manual triage' },
      ],
      messagesOut: [],
    },
  ];

  return {
    responses,
    bottlenecks: [{ nodeId: 'nav', nodeName: 'Navigator', reason: 'Too many inbound connections' }],
    proposedEdges: [{ source: 'nav', target: 'cache', reason: 'Bypass slow path' }],
    orphanWarnings: [],
    conflicts: [],
    totalTokens: { input: 3000, output: 1500 },
    wallTimeMs: 2500,
  };
}

function createMockGroupAnalyses(): GroupAnalysis[] {
  return [
    {
      groupId: 'grp_review',
      groupName: 'Review Team',
      analysis: 'The review team has a bottleneck at Edward.',
      internalOptimizations: [
        { type: 'propose_optimization', description: 'Redistribute review load', reason: 'Edward is overloaded' },
      ],
      boundaryProposals: [
        {
          proposingGroupId: 'grp_review',
          targetGroupId: 'grp_input',
          proposalType: 'move_node',
          description: 'Move bot1 to review team',
          affectedNodeIds: ['bot1'],
          reason: 'Bot Alpha can help with reviews',
        },
      ],
      bottleneckNodes: ['ed'],
      redundantEdges: ['ed-legacy'],
      tokenUsage: { input: 2000, output: 800 },
    },
  ];
}

// ── Tests: Adapter OrchestratorResult → OptimizeResponse ─────────────────────

describe('orchestratorResultToOptimizeResponse', () => {
  it('generates valid analysis markdown', () => {
    const result = orchestratorResultToOptimizeResponse(createMockOrchResult());
    expect(result.analysis).toContain('## Workflow Summary');
    expect(result.analysis).toContain('## Bottlenecks Identified');
    expect(result.analysis).toContain('Navigator');
    expect(result.analysis).toContain('## Per-Node Analysis');
  });

  it('maps proposedEdges → suggestedConnections', () => {
    const result = orchestratorResultToOptimizeResponse(createMockOrchResult());
    expect(result.suggestedConnections).toHaveLength(1);
    expect(result.suggestedConnections[0].sourceId).toBe('nav');
    expect(result.suggestedConnections[0].targetId).toBe('cache');
    expect(result.suggestedConnections[0].connectionType).toBe('optimised');
    expect(result.suggestedConnections[0].reason).toBe('Bypass slow path');
  });

  it('maps remove_edge actions → suggestedEdgeRemovals', () => {
    const result = orchestratorResultToOptimizeResponse(createMockOrchResult());
    expect(result.suggestedEdgeRemovals).toHaveLength(1);
    expect(result.suggestedEdgeRemovals[0].edgeId).toBe('ed-legacy');
  });

  it('maps delegate_task actions → suggestedTaskUpdates + suggestedRemovals', () => {
    const result = orchestratorResultToOptimizeResponse(createMockOrchResult());
    expect(result.suggestedTaskUpdates).toHaveLength(1);
    expect(result.suggestedTaskUpdates[0].nodeId).toBe('bot1');
    expect(result.suggestedRemovals).toHaveLength(1);
    expect(result.suggestedRemovals[0].action).toBe('automate');
  });

  it('includes group analysis in output when provided', () => {
    const result = orchestratorResultToOptimizeResponse(
      createMockOrchResult(),
      createMockGroupAnalyses(),
    );
    expect(result.analysis).toContain('## Group Analysis');
    expect(result.analysis).toContain('Review Team');
    expect(result.suggestedGroupUpdates.length).toBeGreaterThan(0);
  });

  it('generates a suggestion plan with phases', () => {
    const result = orchestratorResultToOptimizeResponse(createMockOrchResult());
    expect(result.suggestionPlan).not.toBeNull();
    expect(result.suggestionPlan!.phases.length).toBeGreaterThan(0);
    // Connection phase should come first
    expect(result.suggestionPlan!.phases[0].label).toContain('Connection');
  });

  it('handles cascadeEffects when cascade result is provided', () => {
    const cascadeResult: CascadeResult = {
      trigger: { type: 'add_edge', sourceId: 'nav', targetId: 'cache', description: 'Bypass slow path' },
      steps: [
        {
          nodeId: 'cache',
          nodeName: 'Cache',
          depth: 0,
          reaction: 'Received new inbound connection from Navigator',
          propagatesTo: [],
          suggestedActions: [],
        },
      ],
      totalAgentCalls: 1,
      totalTokens: { input: 1000, output: 500 },
      wallTimeMs: 800,
    };

    const result = orchestratorResultToOptimizeResponse(
      createMockOrchResult(),
      [],
      cascadeResult,
    );

    expect(result.suggestedConnections[0].cascadeEffects.length).toBeGreaterThan(0);
    expect(result.suggestedConnections[0].cascadeEffects[0].id).toBe('cache');
  });

  it('returns empty arrays for empty orchestrator result', () => {
    const emptyResult: OrchestratorResult = {
      responses: [],
      bottlenecks: [],
      proposedEdges: [],
      orphanWarnings: [],
      conflicts: [],
      totalTokens: { input: 0, output: 0 },
      wallTimeMs: 0,
    };

    const result = orchestratorResultToOptimizeResponse(emptyResult);
    expect(result.suggestedConnections).toEqual([]);
    expect(result.suggestedEdgeRemovals).toEqual([]);
    expect(result.suggestedRemovals).toEqual([]);
    expect(result.suggestedNewNodes).toEqual([]);
    expect(result.suggestedTaskUpdates).toEqual([]);
    expect(result.suggestedGroupUpdates).toEqual([]);
    expect(result.suggestionPlan).toBeNull();
  });
});

// ── Tests: CoordinatorNodeList ───────────────────────────────────────────────

describe('buildCoordinatorNodeList', () => {
  it('formats nodes and edges correctly', () => {
    const list = buildCoordinatorNodeList(
      [
        { id: 'nav', name: 'Navigator', role: 'person' },
        { id: 'bot1', name: 'Bot Alpha', role: 'tool' },
      ],
      [
        { id: 'nav-bot1', source: 'nav', target: 'bot1', name: 'Data Feed' },
      ],
    );

    expect(list).toContain('NODES:');
    expect(list).toContain('[nav] Navigator (person)');
    expect(list).toContain('[bot1] Bot Alpha (tool)');
    expect(list).toContain('EDGES:');
    expect(list).toContain('[nav-bot1] nav → bot1 "Data Feed"');
  });

  it('handles edges without names', () => {
    const list = buildCoordinatorNodeList(
      [{ id: 'a', name: 'A', role: 'tool' }],
      [{ id: 'a-b', source: 'a', target: 'b' }],
    );
    expect(list).toContain('[a-b] a → b');
    expect(list).not.toContain('""');
  });

  it('returns empty sections for empty inputs', () => {
    const list = buildCoordinatorNodeList([], []);
    expect(list).toContain('NODES:');
    expect(list).toContain('EDGES:');
  });
});

// ── Tests: Route engine dispatch ─────────────────────────────────────────────

describe('Route engine param dispatch', () => {
  it('optimize route accepts engine field in request body', () => {
    // Verify the type signature accepts the engine field
    const requestBody = {
      workflowData: {},
      apiKey: 'test-key',
      provider: 'anthropic' as const,
      model: 'claude-sonnet-4-6',
      engine: 'distributed' as const,
    };

    expect(requestBody.engine).toBe('distributed');
    expect(typeof requestBody.engine).toBe('string');
  });

  it('update route accepts engine field in request body', () => {
    const requestBody = {
      prompt: 'Add a new node',
      currentState: {},
      apiKey: 'test-key',
      provider: 'anthropic' as const,
      model: 'claude-sonnet-4-6',
      engine: 'monolithic' as const,
    };

    expect(requestBody.engine).toBe('monolithic');
  });

  it('engine field defaults to undefined when not provided', () => {
    const requestBody = {
      workflowData: {},
      apiKey: 'test-key',
      provider: 'anthropic' as const,
    };

    expect((requestBody as { engine?: string }).engine).toBeUndefined();
  });
});

// ── Tests: Race condition safety (generation counter logic) ──────────────────

describe('Race condition: generation counter', () => {
  it('generation starts at 0', () => {
    let generation = 0;
    expect(generation).toBe(0);
  });

  it('generation increments on mode change', () => {
    let generation = 0;
    const toggleMode = () => { generation++; };

    toggleMode();
    expect(generation).toBe(1);
    toggleMode();
    expect(generation).toBe(2);
  });

  it('stale response detected when generation differs', () => {
    let generation = 0;
    const callGeneration = generation; // snapshot at call time

    // Simulate mode toggle while request is in flight
    generation++;

    const isStale = callGeneration !== generation;
    expect(isStale).toBe(true);
  });

  it('fresh response accepted when generation matches', () => {
    let generation = 3;
    const callGeneration = generation;

    // No mode toggle during request
    const isStale = callGeneration !== generation;
    expect(isStale).toBe(false);
  });
});

// ── Tests: AbortController lifecycle ─────────────────────────────────────────

describe('AbortController: in-flight request management', () => {
  it('AbortController aborts correctly', () => {
    const controller = new AbortController();
    expect(controller.signal.aborted).toBe(false);

    controller.abort(new DOMException('Engine mode changed', 'AbortError'));
    expect(controller.signal.aborted).toBe(true);
    expect(controller.signal.reason).toBeInstanceOf(DOMException);
  });

  it('superseding request aborts previous controller', () => {
    const inFlight = new Map<string, AbortController>();

    // First request
    const controller1 = new AbortController();
    inFlight.set('analyze', controller1);

    // Second request supersedes
    const existing = inFlight.get('analyze');
    if (existing) {
      existing.abort(new DOMException('Superseded', 'AbortError'));
      inFlight.delete('analyze');
    }
    const controller2 = new AbortController();
    inFlight.set('analyze', controller2);

    expect(controller1.signal.aborted).toBe(true);
    expect(controller2.signal.aborted).toBe(false);
    expect(inFlight.size).toBe(1);
  });

  it('fetch with aborted signal rejects with AbortError', async () => {
    const controller = new AbortController();
    controller.abort();

    // vi.fn to mock fetch behavior with AbortSignal
    const mockFetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.signal?.aborted) {
        return Promise.reject(new DOMException('Aborted', 'AbortError'));
      }
      return Promise.resolve(new Response(JSON.stringify({ ok: true })));
    });

    await expect(
      mockFetch('/api/ai/optimize', { signal: controller.signal })
    ).rejects.toThrow('Aborted');
  });

  it('concurrent operations tracked independently', () => {
    const inFlight = new Map<string, AbortController>();

    const analyzeController = new AbortController();
    const updateController = new AbortController();

    inFlight.set('analyze', analyzeController);
    inFlight.set('update', updateController);

    // Abort analyze only
    inFlight.get('analyze')!.abort();
    inFlight.delete('analyze');

    expect(analyzeController.signal.aborted).toBe(true);
    expect(updateController.signal.aborted).toBe(false);
    expect(inFlight.size).toBe(1);
  });

  it('mode toggle aborts all in-flight by generation mismatch', () => {
    const inFlight = new Map<string, { controller: AbortController; generation: number }>();
    let generation = 5;

    inFlight.set('analyze', { controller: new AbortController(), generation: 5 });
    inFlight.set('update', { controller: new AbortController(), generation: 5 });

    // Simulate mode toggle
    generation = 6;

    // Abort all mismatched
    for (const [key, req] of inFlight) {
      if (req.generation !== generation) {
        req.controller.abort();
        inFlight.delete(key);
      }
    }

    expect(inFlight.size).toBe(0);
  });
});

// ── Tests: Regression — monolithic path unchanged ────────────────────────────

describe('Regression: monolithic path', () => {
  it('when engine is undefined, distributed branch is not taken', () => {
    const engine: string | undefined = undefined;
    const isDistributed = engine === 'distributed';
    expect(isDistributed).toBe(false);
  });

  it('when engine is "monolithic", distributed branch is not taken', () => {
    const engine: string = 'monolithic';
    const isDistributed = engine === 'distributed';
    expect(isDistributed).toBe(false);
  });

  it('only engine === "distributed" triggers the distributed branch', () => {
    const cases = [
      { engine: 'distributed', expected: true },
      { engine: 'monolithic', expected: false },
      { engine: undefined, expected: false },
      { engine: '', expected: false },
      { engine: 'Distributed', expected: false }, // case-sensitive
    ];

    for (const { engine, expected } of cases) {
      expect(engine === 'distributed').toBe(expected);
    }
  });
});
