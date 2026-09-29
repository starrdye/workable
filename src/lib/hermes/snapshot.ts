/**
 * hermes/snapshot.ts — Assemble everything the Hermes view needs in one read.
 */

import fs from 'fs';
import path from 'path';
import { USE_HERMES_EDIT } from '@/lib/featureFlags';
import type { HermesSnapshot, HermesTaskDetail } from './types';
import { boardDbPath, readBoards, readCurrentBoardSlug, readProfiles, readProjects, resolveHermesHome, resolveHermesHomes } from './roster';
import { readActivity } from './sessions';
import { HUMAN_ID } from './metrics';
import { readBoard, readTaskHistory } from './kanban';
import { buildEdges, computeMetrics, detectBottleneck } from './metrics';
import { buildSampleBoard } from './sample';

/** Runs, finished cards and review history older than this are left out of metrics. */
export const METRICS_WINDOW_SECONDS = 7 * 24 * 3600;

export class HermesNotFoundError extends Error {}

export interface SnapshotOptions {
  home?: string;
  /** Id from resolveHermesHomes(); ignored when `home` is given. */
  homeId?: string | null;
  board?: string | null;
  /** Use sample cards when the board has none. */
  sampleIfEmpty?: boolean;
  now?: number;
}

export function readSnapshot(opts: SnapshotOptions = {}): HermesSnapshot {
  const homes = resolveHermesHomes();
  const chosen = opts.home ? null : homes.find(h => h.id === opts.homeId) ?? homes[0];
  const home = opts.home ?? chosen?.path ?? resolveHermesHome();
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
  const { activity, events: chatEvents } = readActivity(home, profiles, now);

  // Anyone you chat with directly gets a You → profile edge, so chats can pulse along it.
  const edges = buildEdges(profiles, data.tasks);
  for (const a of activity) {
    if (!a.chats24h) continue;
    const exists = edges.some(e => (e.source === HUMAN_ID && e.target === a.profileId) || (e.source === a.profileId && e.target === HUMAN_ID));
    if (!exists) edges.push({ id: `${HUMAN_ID}->${a.profileId}`, source: HUMAN_ID, target: a.profileId, kind: 'chat', count: 0 });
  }
  const events = [...data.recentEvents, ...chatEvents].sort((a, b) => b.createdAt - a.createdAt).slice(0, 60);
  const isPrimary = path.resolve(home) === path.resolve(resolveHermesHome());

  return {
    home,
    homeId: chosen?.id ?? homes.find(h => h.path === path.resolve(home))?.id ?? 'custom',
    homes,
    activity,
    board,
    boards,
    projects: readProjects(home),
    profiles,
    edges,
    tasks: data.tasks,
    events,
    metrics,
    bottleneck: detectBottleneck(metrics, profiles),
    generatedAt: now,
    sample,
    // Edits only ever target the primary install (HERMES_HOME).
    editable: USE_HERMES_EDIT && !sample && isPrimary,
    warnings,
  };
}

export function readTaskDetail(taskId: string, opts: { home?: string; homeId?: string | null; board?: string | null } = {}): HermesTaskDetail | null {
  const homes = resolveHermesHomes();
  const home = opts.home ?? (homes.find(h => h.id === opts.homeId) ?? homes[0])?.path ?? resolveHermesHome();
  const boards = readBoards(home);
  const slug = opts.board && boards.some(b => b.slug === opts.board) ? opts.board : readCurrentBoardSlug(home, boards);
  const dbPath = boardDbPath(home, slug);
  return dbPath ? readTaskHistory(dbPath, taskId) : null;
}
