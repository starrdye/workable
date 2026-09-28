/**
 * mcp/graphStore.ts — graphs the MCP tools hand out by id, so Hermes can pass
 * a short graphId between calls instead of re-sending the whole graph.
 * Stored as JSON files, so ids survive the MCP server being respawned.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import type { WorkflowGraph } from '@/lib/workflowGraph';

export interface GraphStore {
  put(graph: WorkflowGraph): string;
  get(id: string): WorkflowGraph | null;
}

const ID_RE = /^g_[a-z0-9]{10}$/;

export function defaultGraphDir(): string {
  return process.env.WORKABLE_GRAPH_DIR?.trim() || path.join(os.homedir(), '.workable', 'graphs');
}

export function createFileGraphStore(dir = defaultGraphDir()): GraphStore {
  return {
    put(graph) {
      fs.mkdirSync(dir, { recursive: true });
      const id = `g_${crypto.randomBytes(8).toString('hex').slice(0, 10)}`;
      fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(graph));
      return id;
    },
    get(id) {
      if (!ID_RE.test(id)) return null; // never let an id become a path
      try {
        return JSON.parse(fs.readFileSync(path.join(dir, `${id}.json`), 'utf8')) as WorkflowGraph;
      } catch {
        return null;
      }
    },
  };
}
