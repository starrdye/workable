// src/__tests__/mcp-tools.test.ts
// Hermes plugin phase 4: MCP tool logic with a stand-in model (via the
// generateText override, the same path MCP sampling uses) and a temp store.

import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setGenerateTextOverride } from '@/lib/aiClient';
import { createFileGraphStore } from '@/lib/mcp/graphStore';
import { analyzeBottlenecks, generateWorkflow, patchWorkflow, pushToCanvas, resolveGraph, ToolInputError, type ToolContext } from '@/lib/mcp/tools';
import { applyUpdate, toCanvasImport, toServerState, type WorkflowGraph } from '@/lib/workflowGraph';

const GRAPH_REPLY = JSON.stringify({
  nodes: [
    { id: 'hr', name: 'HR', initials: 'HR', role: 'person', summary: 'Sends the offer', tasks: [{ id: 't_a1', title: 'Send offer', status: 'todo', priority: 'high' }] },
    { id: 'it', name: 'IT', initials: 'IT', role: 'tool', summary: 'Sets up the laptop' },
    { id: 'analyst', name: 'New Analyst', initials: 'NA', role: 'output', summary: 'Starts work' },
  ],
  edges: [
    { id: 'e_hr_it', source: 'hr', target: 'it', name: 'Start date' },
    { id: 'e_it_analyst', source: 'it', target: 'analyst', name: 'Laptop' },
  ],
  groups: [{ id: 'grp_setup', name: 'Setup', color: '#6366F1', nodeIds: ['hr', 'it', 'analyst'], parentGroupId: null }],
});

let dir: string;
let ctx: ToolContext;
const prompts: string[] = [];

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-tools-'));
  ctx = { ai: { provider: 'anthropic', model: 'stand-in', apiKey: 'x' }, store: createFileGraphStore(dir), workableUrl: 'http://localhost:9999', maxConcurrent: 2 };
  setGenerateTextOverride(async ({ systemPrompt, userMessage }) => {
    prompts.push(systemPrompt.slice(0, 60));
    if (systemPrompt.includes('workflow graph parser')) return { text: '```json\n' + GRAPH_REPLY + '\n```', usage: null };
    if (systemPrompt.includes('change coordinator')) {
      return { text: JSON.stringify({
        summary: 'Add a buddy step', changeType: 'add_node', affectedNodeIds: [],
        newNodes: [{ id: 'upd_buddy', name: 'Buddy', initials: 'BU', role: 'person', summary: 'Shows the ropes', connectFrom: ['it'], connectTo: ['analyst'] }],
        newEdges: [], removeNodeIds: [], removeEdgeIds: [], perNodeInstructions: {},
      }), usage: null };
    }
    // Node agents: IT flags itself as a bottleneck.
    const isIt = userMessage.includes('"IT"') || userMessage.includes('IT (');
    return { text: JSON.stringify({
      analysis: 'Looked at my hand-offs.',
      suggestedActions: isIt ? [{ type: 'flag_bottleneck', description: 'Laptop setup takes a week', reason: 'Manual imaging' }] : [],
      messagesToNeighbours: [],
    }), usage: null };
  });
});

afterEach(() => { prompts.length = 0; });
afterAll(() => {
  setGenerateTextOverride(null);
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('graph store', () => {
  it('round-trips graphs and refuses ids that could be paths', () => {
    const store = createFileGraphStore(dir);
    const g: WorkflowGraph = { customNodes: [], customEdges: [], baselinePositions: {} };
    const id = store.put(g);
    expect(id).toMatch(/^g_[a-z0-9]{10}$/);
    expect(store.get(id)).toEqual(g);
    expect(store.get('../../etc/passwd')).toBeNull();
  });
});

describe('MCP tools', () => {
  it('generate_workflow parses, lays out and stores the graph', async () => {
    const out = await generateWorkflow(ctx, { description: 'Analyst onboarding' });
    expect(out.nodeCount).toBe(3);
    expect(out.workflow.nodes.map(n => n.name)).toEqual(['HR', 'IT', 'New Analyst']);
    expect(out.workflow.edges[0]).toMatchObject({ from: 'HR', to: 'IT', name: 'Start date' });
    const g = ctx.store.get(out.graphId)!;
    expect(Object.keys(g.baselinePositions).sort()).toEqual(['analyst', 'hr', 'it']);
  });

  it('analyze_bottlenecks runs one agent per node and reports flagged nodes', async () => {
    const { graphId } = await generateWorkflow(ctx, { description: 'x' });
    prompts.length = 0;
    const out = await analyzeBottlenecks(ctx, { graphId });
    expect(out.agentsRun).toBe(3);
    expect(out.bottlenecks).toEqual([{ nodeId: 'it', node: 'IT', reason: 'Manual imaging' }]);
    expect(out.analysis).toContain('Bottleneck');
  });

  it('patch_workflow returns a new graph and keeps the old one', async () => {
    const { graphId } = await generateWorkflow(ctx, { description: 'x' });
    const out = await patchWorkflow(ctx, { graphId, change: 'Add a buddy' });
    expect(out.previousGraphId).toBe(graphId);
    expect(out.graphId).not.toBe(graphId);
    expect(out.workflow.nodes.map(n => n.name)).toContain('Buddy');
    expect(ctx.store.get(graphId)!.customNodes).toHaveLength(3);
  });

  it('push_to_canvas sends the canvas import and explains an unreachable Workable', async () => {
    const { graphId } = await generateWorkflow(ctx, { description: 'x' });
    let sent: { url: string; body: Record<string, unknown> } | null = null;
    const okFetch = (async (url: string, init: RequestInit) => {
      sent = { url, body: JSON.parse(String(init.body)) };
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const out = await pushToCanvas({ ...ctx, fetchImpl: okFetch }, { graphId });
    expect(out.url).toBe('http://localhost:9999/?open=canvas');
    expect(sent!.url).toBe('http://localhost:9999/api/graph-state');
    expect(sent!.body.action).toBe('importAndReset');

    const downFetch = (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;
    await expect(pushToCanvas({ ...ctx, fetchImpl: downFetch }, { graphId })).rejects.toThrow(/npm run dev/);
  });

  it('explains bad graph input', () => {
    expect(() => resolveGraph(ctx, {})).toThrow(ToolInputError);
    expect(() => resolveGraph(ctx, { graphId: 'g_missing000' })).toThrow(/generate_workflow/);
    expect(() => resolveGraph(ctx, { graph: { nodes: [] } })).toThrow(/customNodes/);
  });
});

describe('workflowGraph', () => {
  const base: WorkflowGraph = {
    customNodes: [
      { id: 'a', labelInitials: 'A', label: 'A', nodeType: 'neural', role: 'person', position: { x: 0, y: 0 } },
      { id: 'b', labelInitials: 'B', label: 'B', nodeType: 'neural', role: 'tool', position: { x: 0, y: 0 } },
    ],
    customEdges: [{ id: 'e_a_b', source: 'a', target: 'b', sequence: 1, weight: 1, isCustom: true }],
    baselinePositions: { a: { x: 0, y: 0 }, b: { x: 1, y: 1 } },
    workflowGroups: [{ id: 'grp_1', name: 'G', color: '#6366F1', nodeIds: ['a', 'b'] }],
  };
  const empty = { nodes: [], edges: [], groups: [] };

  it('applies adds, updates and removals without mutating the input', () => {
    const next = applyUpdate(base, {
      summary: 's',
      add: { ...empty, nodes: [{ id: 'c', name: 'C', initials: 'C', role: 'output' }], edges: [{ id: 'e_b_c', source: 'b', target: 'c' }] },
      update: { nodes: [{ id: 'a', name: 'A2' }], groupExtensions: [{ groupId: 'grp_1', addNodeIds: ['c'], removeNodeIds: [] }], groups: [], nodeTasks: [], edges: [] },
      remove: { nodeIds: [], edgeIds: ['e_a_b'], groupIds: [] },
    });
    expect(next.customNodes.map(n => n.id)).toEqual(['a', 'b', 'c']);
    expect(next.customNodes[0].label).toBe('A2');
    expect(next.customEdges.map(e => e.id)).toEqual(['e_b_c']);
    expect(next.workflowGroups![0].nodeIds).toEqual(['a', 'b', 'c']);
    expect(Object.keys(next.baselinePositions)).toHaveLength(3);
    expect(base.customNodes).toHaveLength(2);
  });

  it('builds a standalone agent state and a canvas import body', () => {
    const s = toServerState(base);
    expect(s.settings.hiddenCoreNodes!.length).toBeGreaterThan(0); // core demo nodes hidden
    expect(s.settings.workflowGroups).toEqual(base.workflowGroups);
    expect(toCanvasImport(base)).toMatchObject({ action: 'importAndReset', customNodes: base.customNodes });
  });
});
