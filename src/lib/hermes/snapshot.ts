/**
 * hermes/snapshot.ts — Assemble everything the Hermes view needs in one read.
 */

import fs from 'fs';
import type { HermesSnapshot, HermesTaskDetail } from './types';
import { boardDbPath, readBoards, readCurrentBoardSlug, readProfiles, readProjects, resolveHermesHome } from './roster';
import { readBoard, readTaskHistory } from './kanban';
import { buildEdges, computeMetrics, detectBottleneck } from './metrics';
import { buildSampleBoard } from './sample';

/** Runs, finished cards and review history older than this are left out of metrics. */
export const METRICS_WINDOW_SECONDS = 7 * 24 * 3600;

export class HermesNotFoundError extends Error {}

export interface SnapshotOptions {
  home?: string;
  board?: string | null;
  /** Use sample cards when the board has none. */
  sampleIfEmpty?: boolean;
  now?: number;
}

export function readSnapshot(opts: SnapshotOptions = {}): HermesSnapshot {
  const home = opts.home ?? resolveHermesHome();
  if (!fs.existsSync(home)) throw new HermesNotFoundError(`No Hermes install found at ${home}. Set HERMES_HOME if it lives elsewhere.`);

  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const warnings: string[] = [];
  const profiles = readProfiles(home);
  const boards = readBoards(home);
  const slug = opts.board && boards.some(b => b.slug === opts.board) ? opts.board : readCurrentBoardSlug(home, boards);
  const board = boards.find(b => b.slug === slug) ?? null;
  const dbPath = boardDbPath(home, slug);

  let data = { tasks: [], recentEvents: [], reviewEvents: [], runs: [] } as ReturnType<typeof readBoard>;
  if (dbPath) {
    try {
      data = readBoard(dbPath, { since: now - METRICS_WINDOW_SECONDS });
    } catch (err) {
      warnings.push(`Couldn't read the board database: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    warnings.push('No kanban database found. Run `hermes kanban init` to create one.');
  }

  const sample = !!opts.sampleIfEmpty && data.tasks.length === 0 && data.runs.length === 0;
  if (sample) data = buildSampleBoard(profiles, now);

  const metrics = computeMetrics(profiles, data.tasks, data.reviewEvents, data.runs, now);
  return {
    home,
    board,
    boards,
    projects: readProjects(home),
    profiles,
    edges: buildEdges(profiles, data.tasks),
    tasks: data.tasks,
    events: data.recentEvents,
    metrics,
    bottleneck: detectBottleneck(metrics, profiles),
    generatedAt: now,
    sample,
    warnings,
  };
}

export function readTaskDetail(taskId: string, opts: { home?: string; board?: string | null } = {}): HermesTaskDetail | null {
  const home = opts.home ?? resolveHermesHome();
  const boards = readBoards(home);
  const slug = opts.board && boards.some(b => b.slug === opts.board) ? opts.board : readCurrentBoardSlug(home, boards);
  const dbPath = boardDbPath(home, slug);
  return dbPath ? readTaskHistory(dbPath, taskId) : null;
}
