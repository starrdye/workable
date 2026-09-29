// src/__tests__/hermes.test.ts
// Hermes plugin: reads a fake HERMES_HOME built in a temp dir, so these tests
// never touch the real ~/.hermes.

import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readProfiles, readBoards, readCurrentBoardSlug } from '@/lib/hermes/roster';
import { readSnapshot, readTaskDetail } from '@/lib/hermes/snapshot';
import {
  HUMAN_ID, buildEdges, detectBottleneck, formatDuration, loadScore, median, timeByHolder, toDotStatus,
} from '@/lib/hermes/metrics';
import { layoutTeam, findEdgeFor } from '@/lib/hermes/layout';
import type { HermesEvent, ProfileMetrics } from '@/lib/hermes/types';

const NOW = 1_790_600_000;
let home: string;
let emptyHome: string;

// Only the columns the plugin reads; the real schema has many more.
const SCHEMA = `
  CREATE TABLE tasks (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT, assignee TEXT, status TEXT NOT NULL,
    priority INTEGER DEFAULT 0, created_by TEXT, created_at INTEGER NOT NULL, started_at INTEGER,
    completed_at INTEGER, consecutive_failures INTEGER NOT NULL DEFAULT 0, last_failure_error TEXT,
    tenant TEXT, project_id TEXT);
  CREATE TABLE task_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL, profile TEXT, status TEXT NOT NULL,
    started_at INTEGER NOT NULL, ended_at INTEGER, outcome TEXT, error TEXT);
  CREATE TABLE task_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL, run_id INTEGER, kind TEXT NOT NULL,
    payload TEXT, created_at INTEGER NOT NULL);`;

function write(file: string, content: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function makeHome(withCards: boolean): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-test-'));
  write(path.join(dir, 'profile.yaml'), "display_name: lead-orchestrator\ndescription: 'Orchestrator: plans and\n  reviews.'\n");
  write(path.join(dir, 'config.yaml'), 'model:\n  default: "anthropic/claude-opus-4.6"\n');
  write(path.join(dir, 'profiles/clerk/profile.yaml'), 'description: Clerk work\n');
  write(path.join(dir, 'profiles/clerk/config.yaml'), 'model:\n  default: deepseek/deepseek-v4-flash\nagent:\n  disabled_toolsets:\n    - computer_use\n');
  write(path.join(dir, 'profiles/researcher/profile.yaml'), 'description: Research\n');
  write(path.join(dir, 'profiles/researcher/config.yaml'), 'model: google/gemini-3.1-pro-preview\n');
  write(path.join(dir, 'kanban/current'), 'main\n');
  write(path.join(dir, 'kanban/boards/main/board.json'), JSON.stringify({ slug: 'main', name: 'Main', description: 'Main board', project_id: 'p1' }));
  write(path.join(dir, 'kanban/boards/old/board.json'), JSON.stringify({ slug: 'old', name: 'Old', archived: true }));

  const db = new Database(path.join(dir, 'kanban/boards/main/kanban.db'));
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);
  if (withCards) {
    const task = db.prepare(`INSERT INTO tasks (id, title, assignee, status, created_by, created_at, started_at, completed_at, consecutive_failures, last_failure_error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    task.run('t1', 'Pull OHLC', 'clerk', 'blocked', 'default', NOW - 7200, NOW - 7000, null, 2, 'HTTP 429 rate limited');
    task.run('t2', 'Research brief', 'default', 'review', 'default', NOW - 9000, NOW - 8800, NOW - 3600, 0, null);
    task.run('t3', 'Sort photos', 'clerk', 'ready', 'cli-user', NOW - 600, null, null, 0, null);
    task.run('t4', 'Old done card', 'researcher', 'done', 'default', NOW - 30 * 86400, null, NOW - 30 * 86400, 0, null);
    task.run('t5', 'Archived', 'researcher', 'archived', 'default', NOW - 100, null, null, 0, null);

    const run = db.prepare('INSERT INTO task_runs (task_id, profile, status, started_at, ended_at, outcome, error) VALUES (?, ?, ?, ?, ?, ?, ?)');
    run.run('t2', 'researcher', 'done', NOW - 8800, NOW - 8200, 'review_requested', null); // id 1, 600s
    run.run('t1', 'clerk', 'failed', NOW - 7000, NOW - 6900, 'crashed', 'HTTP 429 rate limited'); // id 2
    run.run('t1', 'clerk', 'failed', NOW - 6000, NOW - 5900, 'crashed', 'HTTP 429 rate limited'); // id 3

    const ev = db.prepare('INSERT INTO task_events (task_id, run_id, kind, payload, created_at) VALUES (?, ?, ?, ?, ?)');
    ev.run('t2', null, 'created', JSON.stringify({ assignee: 'researcher' }), NOW - 9000);
    ev.run('t2', 1, 'claimed', JSON.stringify({ run_id: 1 }), NOW - 8800);
    ev.run('t2', 1, 'review_requested', JSON.stringify({ implementer: 'researcher', reviewer: 'default', summary: 'Brief ready' }), NOW - 3600);
    ev.run('t1', 2, 'blocked', JSON.stringify({ reason: 'rate limited' }), NOW - 5900);
    // A past review that took 30 minutes.
    ev.run('tx', null, 'review_requested', JSON.stringify({ implementer: 'clerk', reviewer: 'default' }), NOW - 20000);
    ev.run('tx', null, 'completed', null, NOW - 18200);
  }
  db.close();

  const pdb = new Database(path.join(dir, 'projects.db'));
  pdb.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, description TEXT, icon TEXT,
    color TEXT, board_slug TEXT, primary_path TEXT, created_at INTEGER NOT NULL, archived INTEGER NOT NULL DEFAULT 0)`);
  pdb.prepare('INSERT INTO projects (id, slug, name, color, board_slug, created_at) VALUES (?, ?, ?, ?, ?, ?)').run('p1', 'vault', 'Vault', '#6366F1', 'main', NOW);
  pdb.close();
  return dir;
}

function sha(file: string) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

beforeAll(() => {
  home = makeHome(true);
  emptyHome = makeHome(false);
});

afterAll(() => {
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(emptyHome, { recursive: true, force: true });
});

describe('roster', () => {
  it('reads the default profile first, then named profiles', () => {
    const profiles = readProfiles(home);
    expect(profiles.map(p => p.id)).toEqual(['default', 'clerk', 'researcher']);
    expect(profiles[0]).toMatchObject({ name: 'lead-orchestrator', isDefault: true, model: 'anthropic/claude-opus-4.6', unattended: false });
    expect(profiles[0].description).toBe('Orchestrator: plans and reviews.');
    expect(profiles[1]).toMatchObject({ model: 'deepseek/deepseek-v4-flash', unattended: true });
    expect(profiles[2].model).toBe('google/gemini-3.1-pro-preview');
  });

  it('skips archived boards and follows kanban/current', () => {
    const boards = readBoards(home);
    expect(boards.map(b => b.slug)).toEqual(['main']);
    expect(readCurrentBoardSlug(home, boards)).toBe('main');
  });
});

describe('status mapping', () => {
  it('folds nine Hermes statuses into five task dots', () => {
    expect(['triage', 'todo', 'ready', 'scheduled'].map(toDotStatus)).toEqual(['todo', 'todo', 'todo', 'todo']);
    expect(toDotStatus('running')).toBe('in-progress');
    expect(toDotStatus('review')).toBe('review');
    expect(toDotStatus('blocked')).toBe('blocked');
    expect(toDotStatus('done')).toBe('done');
  });
});

describe('readSnapshot (live board)', () => {
  it('reads cards, skipping archived and old done cards', () => {
    const s = readSnapshot({ home, now: NOW });
    expect(s.sample).toBe(false);
    expect(s.board?.slug).toBe('main');
    expect(s.tasks.map(t => t.id).sort()).toEqual(['t1', 't2', 't3']);
    expect(s.projects).toEqual([{ id: 'p1', slug: 'vault', name: 'Vault', color: '#6366F1', boardSlug: 'main' }]);
  });

  it('maps events to hand-offs between profiles', () => {
    const s = readSnapshot({ home, now: NOW });
    const byKind = (k: string) => s.events.find(e => e.kind === k && e.taskId === 't2')!;
    expect(byKind('created')).toMatchObject({ from: 'default', to: 'researcher', at: null });
    expect(byKind('claimed')).toMatchObject({ from: null, to: null, at: 'researcher' });
    expect(byKind('review_requested')).toMatchObject({ from: 'researcher', to: 'default', summary: 'Brief ready' });
    expect(s.events.map(e => e.createdAt)).toEqual([...s.events.map(e => e.createdAt)].sort((a, b) => b - a)); // newest first
  });

  it('builds roster edges plus observed flows from outside the team', () => {
    const s = readSnapshot({ home, now: NOW });
    const ids = s.edges.map(e => e.id).sort();
    expect(ids).toEqual([`${HUMAN_ID}->clerk`, `${HUMAN_ID}->default`, 'default->clerk', 'default->researcher'].sort());
    expect(s.edges.find(e => e.id === 'default->clerk')).toMatchObject({ kind: 'roster', count: 1 });
    expect(s.edges.find(e => e.id === `${HUMAN_ID}->clerk`)).toMatchObject({ kind: 'observed', count: 1 });
  });

  it('computes per-profile metrics from runs and review history', () => {
    const s = readSnapshot({ home, now: NOW });
    const m = (id: string) => s.metrics.find(x => x.profileId === id)!;
    expect(m('default')).toMatchObject({ reviewQueue: 1, oldestReviewWait: 3600, medianReviewWait: 1800 });
    expect(m('clerk')).toMatchObject({ queued: 1, blocked: 1, runs: 2, successRate: 0, failures: 2, lastError: 'HTTP 429 rate limited' });
    expect(m('researcher')).toMatchObject({ runs: 1, successRate: 1, medianRunSeconds: 600 });
  });

  it('calls out the blocked worker as the bottleneck', () => {
    const s = readSnapshot({ home, now: NOW });
    expect(s.bottleneck?.profileId).toBe('clerk');
    expect(s.bottleneck?.reason).toContain('HTTP 429');
  });

  it('never modifies the board database', () => {
    const db = path.join(home, 'kanban/boards/main/kanban.db');
    const before = sha(db);
    readSnapshot({ home, now: NOW });
    readTaskDetail('t2', { home });
    expect(sha(db)).toBe(before);
    expect(readSnapshot({ home, now: NOW }).warnings).toEqual([]);
  });

  it('returns one card\'s full history for Replay', () => {
    const d = readTaskDetail('t2', { home })!;
    expect(d.task.title).toBe('Research brief');
    expect(d.events.map(e => e.kind)).toEqual(['created', 'claimed', 'review_requested']);
    expect(d.runs).toHaveLength(1);
    expect(readTaskDetail('nope', { home })).toBeNull();
  });
});

describe('readSnapshot (empty board)', () => {
  it('stays empty unless sample data is requested', () => {
    const s = readSnapshot({ home: emptyHome, now: NOW });
    expect(s.sample).toBe(false);
    expect(s.tasks).toEqual([]);
    expect(s.bottleneck).toBeNull();
  });

  it('fills an empty board with labelled sample data built on the real roster', () => {
    const s = readSnapshot({ home: emptyHome, now: NOW, sampleIfEmpty: true });
    expect(s.sample).toBe(true);
    expect(s.tasks.length).toBeGreaterThan(0);
    const assignees = new Set(s.tasks.map(t => t.assignee));
    for (const a of assignees) expect(['default', 'clerk', 'researcher']).toContain(a);
    expect(s.bottleneck).not.toBeNull();
  });

  it('throws a clear error when HERMES_HOME does not exist', () => {
    expect(() => readSnapshot({ home: path.join(emptyHome, 'missing') })).toThrow(/No Hermes install/);
  });
});

describe('metrics helpers', () => {
  const base: ProfileMetrics = {
    profileId: 'x', queued: 0, running: 0, blocked: 0, reviewQueue: 0, oldestReviewWait: null, medianReviewWait: null,
    runs: 0, successRate: null, medianRunSeconds: null, failures: 0, lastError: null, load: 0,
  };

  it('median and formatDuration', () => {
    expect(median([])).toBeNull();
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(45)).toBe('45s');
    expect(formatDuration(600)).toBe('10m');
    expect(formatDuration(3 * 3600 + 12 * 60)).toBe('3h 12m');
  });

  it('scores a stale review queue above the bottleneck threshold', () => {
    const idle = { ...base };
    const stale = { ...base, reviewQueue: 4, oldestReviewWait: 4 * 3600 };
    expect(loadScore(idle)).toBe(0);
    expect(loadScore(stale)).toBeGreaterThanOrEqual(0.3);
    const profiles = [{ id: 'x', name: 'x', description: '', model: null, isDefault: true, unattended: false, disabledToolsets: [] }];
    expect(detectBottleneck([{ ...idle, load: loadScore(idle) }], profiles)).toBeNull();
    expect(detectBottleneck([{ ...stale, load: loadScore(stale) }], profiles)?.reason).toMatch(/4 cards are waiting/);
  });

  it('attributes a card\'s time to whoever held it', () => {
    const ev = (kind: string, t: number, e: Partial<HermesEvent>): HermesEvent =>
      ({ id: t, taskId: 'a', taskTitle: 'a', kind, createdAt: t, from: null, to: null, at: null, summary: null, ...e });
    const out = timeByHolder([
      ev('created', 0, { from: 'lead', to: 'w' }),
      ev('claimed', 60, { at: 'w' }),
      ev('review_requested', 660, { from: 'w', to: 'lead' }),
      ev('completed', 4260, { at: 'lead' }),
    ]);
    expect(out).toEqual([{ holder: 'lead', seconds: 3600 }, { holder: 'w', seconds: 660 }]);
  });

  it('buildEdges ignores self-assigned cards', () => {
    const profiles = readProfiles(home);
    const edges = buildEdges(profiles, [{ id: 'z', title: '', assignee: 'clerk', createdBy: 'clerk', status: 'todo', dot: 'todo', priority: 0, createdAt: 0, startedAt: null, completedAt: null, consecutiveFailures: 0, lastFailureError: null, tenant: null, projectId: null }]);
    expect(edges.every(e => e.kind === 'roster' && e.count === 0)).toBe(true);
  });
});

describe('layout', () => {
  it('puts you and the orchestrator on top and workers below, deterministically', () => {
    const profiles = readProfiles(home);
    const a = layoutTeam(profiles), b = layoutTeam(profiles);
    expect([...a.nodes.entries()]).toEqual([...b.nodes.entries()]);
    expect(a.nodes.get(HUMAN_ID)!.y).toBe(a.nodes.get('default')!.y);
    expect(a.nodes.get('clerk')!.y).toBeGreaterThan(a.nodes.get('default')!.y);
  });

  it('finds the drawn edge for a hand-off in either direction', () => {
    const edges = buildEdges(readProfiles(home), []);
    expect(findEdgeFor(edges, 'default', 'clerk')).toMatchObject({ reverse: false });
    expect(findEdgeFor(edges, 'clerk', 'default')).toMatchObject({ reverse: true });
    expect(findEdgeFor(edges, 'clerk', 'researcher')).toBeNull();
  });
});
