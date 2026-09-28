/**
 * hermes/sample.ts — Illustrative board data built around the real roster.
 *
 * Used when the live board is empty so the Live view still shows what it does.
 * The snapshot is flagged `sample: true` and the UI labels it as example data.
 */

import type { HermesEvent, HermesProfile, HermesRun, HermesTask, HermesTaskStatus } from './types';
import { toDotStatus } from './metrics';

const TITLES = [
  'Compare three options and summarise trade-offs',
  'Pull last week\'s figures into a table',
  'Draft three short captions',
  'Summarise the earnings call transcript',
  'Sort and de-duplicate the September photos',
  'Tidy formatting in the weekly notes',
  'Check sources for the research brief',
  'Rename screenshots to the naming convention',
];

export interface SampleBoard {
  tasks: HermesTask[];
  recentEvents: HermesEvent[];
  reviewEvents: HermesEvent[];
  runs: HermesRun[];
}

export function buildSampleBoard(profiles: HermesProfile[], now: number): SampleBoard {
  const hub = profiles.find(p => p.isDefault) ?? profiles[0];
  const workers = profiles.filter(p => p !== hub);
  const tasks: HermesTask[] = [];
  const events: HermesEvent[] = [];
  const runs: HermesRun[] = [];
  if (!hub) return { tasks, recentEvents: [], reviewEvents: [], runs };

  let n = 0, eventId = 1, runId = 1;
  const addTask = (assignee: string, status: HermesTaskStatus, ageMin: number, extra: Partial<HermesTask> = {}) => {
    const id = `t_s${String(++n).padStart(2, '0')}`;
    const task: HermesTask = {
      id, title: TITLES[(n - 1) % TITLES.length], assignee, createdBy: hub.id, status, dot: toDotStatus(status),
      priority: 0, createdAt: now - ageMin * 60, startedAt: status === 'todo' ? null : now - (ageMin - 2) * 60,
      completedAt: null, consecutiveFailures: 0, lastFailureError: null, tenant: null, projectId: null, ...extra,
    };
    tasks.push(task);
    return task;
  };
  const addEvent = (t: HermesTask, kind: string, agoSec: number, e: Partial<HermesEvent>) => {
    events.push({ id: eventId++, taskId: t.id, taskTitle: t.title, kind, createdAt: now - agoSec, from: null, to: null, at: null, summary: null, ...e });
  };

  // Run history: mostly healthy, with one worker that struggles.
  workers.forEach((w, wi) => {
    for (let i = 0; i < 10; i++) {
      const start = now - (i + 1) * 5400 - wi * 600;
      const bad = wi === 1 && i % 3 === 0;
      runs.push({
        id: runId++, taskId: `t_h${wi}${i}`, profile: w.id, status: bad ? 'failed' : 'done',
        outcome: bad ? 'crashed' : i % 2 ? 'review_requested' : 'completed',
        startedAt: start, endedAt: start + 300 + ((i * 97 + wi * 131) % 900), error: bad ? 'HTTP 429: rate limited by upstream API' : null,
      });
    }
  });

  workers.forEach((w, wi) => {
    const running = addTask(w.id, 'running', 6 + wi * 3);
    addEvent(running, 'created', 60 * (6 + wi * 3), { from: hub.id, to: w.id });
    addEvent(running, 'claimed', 60 * (5 + wi * 3), { at: w.id });
    addTask(w.id, 'todo', 20 + wi * 5);
    if (wi === 1) {
      const blocked = addTask(w.id, 'blocked', 95, {
        consecutiveFailures: 2, lastFailureError: 'HTTP 429: rate limited by upstream API',
      });
      addEvent(blocked, 'blocked', 60 * 40, { at: w.id, summary: 'HTTP 429: rate limited by upstream API' });
    }
  });

  // Finished work waits on the orchestrator: the classic review bottleneck.
  const reviewEvents: HermesEvent[] = [];
  workers.slice(0, 4).forEach((w, wi) => {
    const ageMin = 200 - wi * 45;
    const t = addTask(hub.id, 'review', ageMin, { completedAt: now - (ageMin - 20) * 60 });
    t.title = TITLES[(wi + 2) % TITLES.length];
    const ev: HermesEvent = {
      id: eventId++, taskId: t.id, taskTitle: t.title, kind: 'review_requested', createdAt: now - (ageMin - 20) * 60,
      from: w.id, to: hub.id, at: null, summary: 'Ready for review',
    };
    events.push(ev);
    reviewEvents.push(ev);
  });
  // Past reviews, so the median review wait has history.
  for (let i = 0; i < 6; i++) {
    const start = now - 86400 + i * 7200;
    reviewEvents.push(
      { id: eventId++, taskId: `t_r${i}`, taskTitle: 'Past card', kind: 'review_requested', createdAt: start, from: workers[i % Math.max(1, workers.length)]?.id ?? null, to: hub.id, at: null, summary: null },
      { id: eventId++, taskId: `t_r${i}`, taskTitle: 'Past card', kind: 'completed', createdAt: start + 5400 + i * 900, from: null, to: null, at: hub.id, summary: null },
    );
  }
  reviewEvents.sort((a, b) => a.createdAt - b.createdAt);

  // Two hand-offs in the last minute keep the pulses moving.
  if (workers[0]) addEvent(tasks[0], 'created', 20, { from: hub.id, to: workers[0].id });
  const back = workers[2] ?? workers[0];
  if (back) addEvent(tasks.find(t => t.assignee === back.id) ?? tasks[0], 'review_requested', 40, { from: back.id, to: hub.id, summary: 'Draft ready' });

  return { tasks, recentEvents: [...events].sort((a, b) => b.createdAt - a.createdAt), reviewEvents, runs };
}
