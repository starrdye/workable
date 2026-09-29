/**
 * Workable MCP server (stdio) — lets an agent system such as Hermes call
 * Workable's workflow tools without the UI.
 *
 *   npm run mcp
 *   # from anywhere (e.g. an MCP client config):
 *   node <repo>/node_modules/tsx/dist/cli.mjs --tsconfig <repo>/tsconfig.json <repo>/mcp/server.ts
 *
 * Model calls:
 *   - default: MCP sampling — the calling client (Hermes) runs each prompt on
 *     its own model and key. Workable holds no API key.
 *   - direct: set WORKABLE_AI_PROVIDER (anthropic | gemini | doubao),
 *     WORKABLE_AI_MODEL, WORKABLE_AI_KEY and optionally WORKABLE_AI_BASE_URL.
 *     WORKABLE_AI_REASONING_EFFORT (e.g. none) is sent to Doubao to cut thinking cost.
 *
 * Other env: WORKABLE_URL (default http://localhost:3000) for push_to_canvas,
 *            WORKABLE_GRAPH_DIR (default ~/.workable/graphs).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { setDoubaoExtraBody, setGenerateTextOverride, type AIProvider, type AIProviderConfig } from '../src/lib/aiClient';
import { createFileGraphStore } from '../src/lib/mcp/graphStore';
import { analyzeBottlenecks, generateWorkflow, patchWorkflow, pushToCanvas, type ToolContext } from '../src/lib/mcp/tools';

// stdout carries the protocol; anything the libraries log must go to stderr.
console.log = console.error;
console.info = console.error;

const SAMPLING_TIMEOUT_MS = 180_000;

const server = new McpServer({ name: 'workable', version: '0.1.0' });

function aiConfigFromEnv(): AIProviderConfig | null {
  const provider = process.env.WORKABLE_AI_PROVIDER?.trim() as AIProvider | undefined;
  if (!provider) return null;
  const apiKey = process.env.WORKABLE_AI_KEY?.trim() ?? '';
  const model = process.env.WORKABLE_AI_MODEL?.trim() ?? '';
  if (!apiKey || !model) throw new Error('WORKABLE_AI_PROVIDER is set, so WORKABLE_AI_KEY and WORKABLE_AI_MODEL are required too.');
  return { provider, model, apiKey, baseUrl: process.env.WORKABLE_AI_BASE_URL?.trim() || undefined };
}

const direct = aiConfigFromEnv();
const effort = process.env.WORKABLE_AI_REASONING_EFFORT?.trim();
if (direct?.provider === 'doubao' && effort) setDoubaoExtraBody({ reasoning_effort: effort });
if (!direct) {
  setGenerateTextOverride(async ({ systemPrompt, userMessage, maxTokens }) => {
    if (!server.server.getClientCapabilities()?.sampling) {
      throw new Error('This MCP client does not support sampling. Set WORKABLE_AI_PROVIDER, WORKABLE_AI_MODEL and WORKABLE_AI_KEY instead.');
    }
    const res = await server.server.createMessage(
      { systemPrompt, maxTokens, includeContext: 'none', messages: [{ role: 'user', content: { type: 'text', text: userMessage } }] },
      { timeout: SAMPLING_TIMEOUT_MS },
    );
    const blocks = Array.isArray(res.content) ? res.content : [res.content];
    const text = blocks.map(b => (b && b.type === 'text' ? b.text : '')).join('');
    return { text, usage: null };
  });
}

const ctx: ToolContext = {
  // In sampling mode the override answers every call; these fields are placeholders.
  ai: direct ?? { provider: 'anthropic', model: 'mcp-sampling', apiKey: 'mcp-sampling' },
  store: createFileGraphStore(),
  workableUrl: process.env.WORKABLE_URL?.trim() || 'http://localhost:3000',
  maxConcurrent: Number(process.env.WORKABLE_MAX_CONCURRENT) || 3,
};

type Handler<T> = (input: T) => Promise<unknown>;
function wrap<T>(fn: Handler<T>) {
  return async (input: T) => {
    try {
      const out = await fn(input);
      return { content: [{ type: 'text' as const, text: JSON.stringify(out, null, 1) }] };
    } catch (err) {
      return { isError: true, content: [{ type: 'text' as const, text: err instanceof Error ? err.message : String(err) }] };
    }
  };
}

const graphInput = {
  graphId: z.string().optional().describe('Id returned by generate_workflow or patch_workflow.'),
  graph: z.any().optional().describe('A full graph object instead of graphId.'),
};

server.registerTool('generate_workflow', {
  title: 'Generate workflow',
  description: 'Map a process described in plain English into a workflow graph (people, tools, hand-offs, phases). Returns a graphId for the other tools, a compact summary, and chatCard: put chatCard on its own line in your reply so the user sees the graph inline.',
  inputSchema: { description: z.string().min(3).describe('The process to map, in plain English.') },
}, wrap(input => generateWorkflow(ctx, input)));

server.registerTool('analyze_bottlenecks', {
  title: 'Analyze bottlenecks',
  description: 'Run one analysis agent per node over a workflow graph and return bottlenecks, suggested connections, orphaned steps and a written analysis. Takes a minute or more on large graphs.',
  inputSchema: graphInput,
}, wrap(input => analyzeBottlenecks(ctx, input)));

server.registerTool('patch_workflow', {
  title: 'Patch workflow',
  description: 'Apply a plain-English change to a workflow graph (add, remove or rename steps, reassign tasks). Returns a new graphId (the original is kept) and chatCard to show the updated graph inline.',
  inputSchema: { ...graphInput, change: z.string().min(3).describe('The change to make, in plain English.') },
}, wrap(input => patchWorkflow(ctx, input)));

server.registerTool('push_to_canvas', {
  title: 'Show on Workable canvas',
  description: 'Put a workflow graph on the Workable canvas for a human to review. Replaces what is currently on the canvas. Needs Workable running locally.',
  inputSchema: graphInput,
}, wrap(input => pushToCanvas(ctx, input)));

async function main() {
  await server.connect(new StdioServerTransport());
  console.error(`[workable-mcp] ready · model calls via ${direct ? `${direct.provider}/${direct.model}` : 'MCP sampling'}`);
}

main().catch(err => {
  console.error('[workable-mcp] failed to start:', err);
  process.exit(1);
});
