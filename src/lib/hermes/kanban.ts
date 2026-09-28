/**
 * hermes/kanban.ts — Read-only access to a Hermes kanban board database.
 *
 * The board is opened with { readonly: true } on every call and closed
 * straight after. Hermes runs the DB in WAL mode, so these reads never block
 * the dispatcher's writes. This module never claims, heartbeats or edits.
 */

import Database from 'better-sqlite3';
import type { HermesEvent, HermesRun, HermesTask, HermesTaskStatus } from './types';
import { REVIEW_EXIT_KINDS, toDotStatus } from './metrics';

interface TaskRow {
  id: string; title: string; assignee: string | null; created_by: string | null; status: string;
  priority: number | null; created_at: number; started_at: number | null; completed_at: number | null;
  consecutive_failures: number | null; last_failure_error: string | null; tenant: string | null; project_id: string | null;
}

interface EventRow {
  id: number; task_id: string; kind: string; payload: string | null; created_at: number;
  title: string | null; assignee: string | null; created_by: string | null; run_profile: string | null;
}

interface RunRow {
  id: number; task_id: string; profile: string | null; status: string; outcome: string | null;
  started_at: number; ended_at: number | null; error: string | null;
}

function mapTask(r: TaskRow): HermesTask {
  return {
    id: r.id,
    title: r.title,
    assignee: r.assignee || null,
    createdBy: r.created_by || null,
    status: r.status as HermesTaskStatus,
    dot: toDotStatus(r.status),
    priority: r.priority ?? 0,
    createdAt: r.created_at,
    startedAt: r.started_at,
    completedAt: r.completed_at,
    consecutiveFailures: r.consecutive_failures ?? 0,
    lastFailureError: r.last_failure_error ? r.last_failure_error.slice(0, 300) : null,
    tenant: r.tenant || null,
    projectId: r.project_id || null,
  };
}

function parsePayload(s: string | null): Record<string, unknown> {
  if (!s) return {};
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' ? v : {};
  } catch { return {}; }
}

function s(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** Work out which profile(s) an event belongs to, so the canvas can place or animate it. */
export function mapEvent(r: EventRow): HermesEvent {
  const p = parsePayload(r.payload);
  const worker = r.run_profile || r.assignee;
  let from: string | null = null, to: string | null = null, at: string | null = null;

  switch (r.kind) {
    case 'created':
      from = r.created_by; to = s(p.assignee) ?? r.assignee; break;
    case 'assigned':
      from = s(p.from); to = s(p.assignee); break;
    case 'review_requested':
      from = s(p.implementer) ?? worker; to = s(p.reviewer) ?? r.created_by; break;
    case 'changes_requested':
      from = s(p.reviewer) ?? r.assignee; to = s(p.implementer) ?? s(p.assignee); break;
    case 'completed':
      from = worker; to = r.created_by; break;
    default:
      at = worker;
  }
  // A hand-off with a missing or self-referencing end is shown as an on-node event instead.
  if ((from || to) && (!from || !to || from === to)) { at = to ?? from; from = to = null; }

  const summary = s(p.summary) ?? s(p.reason) ?? s(p.error) ?? null;
  return {
    id: r.id,
    taskId: r.task_id,
    taskTitle: r.title ?? r.task_id,
    kind: r.kind,
    createdAt: r.created_at,
    from, to, at,
    summary: summary ? summary.slice(0, 200) : null,
  };
}

const EVENT_SELECT = `
  SELECT e.id, e.task_id, e.kind, e.payload, e.created_at,
         t.title, t.assignee, t.created_by, r.profile AS run_profile
  FROM task_events e
  LEFT JOIN tasks t ON t.id = e.task_id
  LEFT JOIN task_runs r ON r.id = e.run_id`;

export interface BoardData {
  tasks: HermesTask[];
  /** Newest first, capped at `eventLimit`. */
  recentEvents: HermesEvent[];
  /** review_requested / review-exit events inside the metrics window, oldest first. */
  reviewEvents: HermesEvent[];
  /** Runs that started inside the metrics window. */
  runs: HermesRun[];
}

export interface ReadBoardOptions {
  /** Unix seconds; runs and review history before this are ignored. */
  since: number;
  eventLimit?: number;
}

export function readBoard(dbPath: string, opts: ReadBoardOptions): BoardData {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const tasks = (db.prepare(`
      SELECT id, title, assignee, created_by, status, priority, created_at, started_at, completed_at,
             consecutive_failures, last_failure_error, tenant, project_id
      FROM tasks
      WHERE status != 'archived' AND (status != 'done' OR completed_at >= ?)
      ORDER BY priority DESC, created_at DESC`).all(opts.since) as TaskRow[]).map(mapTask);

    const recentEvents = (db.prepare(`${EVENT_SELECT} ORDER BY e.id DESC LIMIT ?`)
      .all(opts.eventLimit ?? 60) as EventRow[]).map(mapEvent);

    const kinds = ['review_requested', ...REVIEW_EXIT_KINDS];
    const reviewEvents = (db.prepare(`${EVENT_SELECT}
      WHERE e.created_at >= ? AND e.kind IN (${kinds.map(() => '?').join(',')})
      ORDER BY e.id ASC`).all(opts.since, ...kinds) as EventRow[]).map(mapEvent);

    const runs = (db.prepare(`
      SELECT id, task_id, profile, status, outcome, started_at, ended_at, error
      FROM task_runs WHERE started_at >= ? ORDER BY started_at ASC`).all(opts.since) as RunRow[]).map(mapRun);

    return { tasks, recentEvents, reviewEvents, runs };
  } finally {
    db.close();
  }
}

function mapRun(r: RunRow): HermesRun {
  return {
    id: r.id, taskId: r.task_id, profile: r.profile, status: r.status, outcome: r.outcome,
    startedAt: r.started_at, endedAt: r.ended_at, error: r.error ? r.error.slice(0, 300) : null,
  };
}

/** Full history of one card, for Replay mode. Returns null when the card doesn't exist. */
export function readTaskHistory(dbPath: string, taskId: string): { task: HermesTask; events: HermesEvent[]; runs: HermesRun[] } | null {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const row = db.prepare(`
      SELECT id, title, assignee, created_by, status, priority, created_at, started_at, completed_at,
             consecutive_failures, last_failure_error, tenant, project_id
      FROM tasks WHERE id = ?`).get(taskId) as TaskRow | undefined;
    if (!row) return null;
    const events = (db.prepare(`${EVENT_SELECT} WHERE e.task_id = ? ORDER BY e.id ASC`).all(taskId) as EventRow[]).map(mapEvent);
    const runs = (db.prepare(`
      SELECT id, task_id, profile, status, outcome, started_at, ended_at, error
      FROM task_runs WHERE task_id = ? ORDER BY started_at ASC`).all(taskId) as RunRow[]).map(mapRun);
    return { task: mapTask(row), events, runs };
  } finally {
    db.close();
  }
}
