// src/__tests__/hermes-cron.test.ts
// Scheduled jobs (`hermes cron`) read from a fake install, read-only.

import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { describeSchedule, readJobs } from '@/lib/hermes/cron';
import { jobTone, nextJob, teamSummary } from '@/lib/hermes/status';
import type { HermesProfile, HermesSnapshot } from '@/lib/hermes/types';

const NOW = Math.floor(Date.parse('2026-09-30T11:20:00+08:00') / 1000);
let home: string;

const profile = (id: string, isDefault = false): HermesProfile =>
  ({ id, name: id, description: '', model: null, isDefault, unattended: !isDefault, disabledToolsets: [] });
const profiles = [profile('default', true), profile('clerk'), profile('researcher')];

function writeJobs(dir: string, jobs: object[]) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'jobs.json'), JSON.stringify({ jobs }));
}

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-cron-'));
  const clerk = path.join(home, 'profiles/clerk/cron');
  writeJobs(clerk, [
    { id: 'j1', name: 'Time check', schedule: { kind: 'interval', minutes: 30, display: 'every 30m' }, schedule_display: 'every 30m',
      enabled: true, state: 'scheduled', next_run_at: '2026-09-30T11:42:00+08:00', last_run_at: '2026-09-30T11:13:00+08:00', last_status: 'ok' },
    { id: 'j2', name: 'Broken report', schedule: { kind: 'cron', expr: '0 18 * * *', display: '0 18 * * *' }, schedule_display: '0 18 * * *',
      enabled: true, state: 'scheduled', next_run_at: '2026-09-30T18:00:00+08:00', last_status: 'error', last_error: 'Provider timed out\nstack…' },
  ]);
  const db = new Database(path.join(clerk, 'executions.db'));
  db.exec(`CREATE TABLE executions (id TEXT PRIMARY KEY, job_id TEXT NOT NULL, source TEXT NOT NULL, process_id TEXT NOT NULL, pid INTEGER NOT NULL,
    status TEXT NOT NULL, claimed_at TEXT NOT NULL, started_at TEXT, finished_at TEXT, error TEXT)`);
  const ins = db.prepare('INSERT INTO executions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  ins.run('e1', 'j1', 'ticker', 'p', 1, 'completed', '2026-09-30T10:43:00+08:00', '2026-09-30T10:43:00+08:00', '2026-09-30T10:43:30+08:00', null);
  ins.run('e2', 'j1', 'ticker', 'p', 1, 'completed', '2026-09-30T11:13:00+08:00', '2026-09-30T11:13:00+08:00', '2026-09-30T11:13:30+08:00', null);
  ins.run('e3', 'j2', 'ticker', 'p', 1, 'failed', '2026-09-29T18:00:00+08:00', '2026-09-29T18:00:00+08:00', '2026-09-29T18:01:00+08:00', 'x');
  db.close();
  fs.mkdirSync(path.join(clerk, 'output/j1'), { recursive: true });
  fs.writeFileSync(path.join(clerk, 'output/j1/2026-09-30_11-13-00.md'), '# Cron Job\n\n## Prompt\n\nsecret prompt\n\n## Response\n\nIt is 11:13.\nmore\n');
  writeJobs(path.join(home, 'profiles/researcher/cron'), [
    { id: 'j3', name: 'Morning summary', schedule: { kind: 'cron', expr: '0 9 * * 1-5', display: '0 9 * * 1-5' }, schedule_display: '0 9 * * 1-5',
      enabled: false, state: 'paused', paused_at: '2026-09-30T11:00:00+08:00', paused_reason: 'test job', next_run_at: null },
  ]);
});

afterAll(() => fs.rmSync(home, { recursive: true, force: true }));

describe('describeSchedule', () => {
  it('puts common schedules in plain words', () => {
    expect(describeSchedule({ kind: 'interval', minutes: 30 }, 'every 30m')).toBe('Every 30 min');
    expect(describeSchedule({ kind: 'interval', minutes: 120 }, 'every 2h')).toBe('Every 2 h');
    expect(describeSchedule({ kind: 'cron', expr: '0 9 * * 1-5' }, '')).toBe('Weekdays at 09:00');
    expect(describeSchedule({ kind: 'cron', expr: '30 7 * * *' }, '')).toBe('Daily at 07:30');
    expect(describeSchedule({ kind: 'cron', expr: '0 10 * * 1' }, '')).toBe('Mondays at 10:00');
    expect(describeSchedule({ kind: 'cron', expr: '*/15 * * * *' }, '')).toBe('Every 15 min');
    expect(describeSchedule({ kind: 'once' }, 'once at 5pm')).toBe('once at 5pm');
  });
});

describe('readJobs', () => {
  it('reads every profile\'s jobs, soonest first, with state, runs and the last reply', () => {
    const jobs = readJobs(home, profiles, NOW);
    expect(jobs.map(j => [j.profileId, j.name, j.state])).toEqual([
      ['clerk', 'Time check', 'scheduled'],
      ['clerk', 'Broken report', 'error'],
      ['researcher', 'Morning summary', 'paused'],
    ]);
    const tc = jobs[0];
    expect(tc).toMatchObject({ scheduleText: 'Every 30 min', lastStatus: 'ok', lastReply: 'It is 11:13.' });
    expect(tc.runs.map(r => r.status)).toEqual(['completed', 'completed']);
    expect(jobs[1].lastError).toBe('Provider timed out');
    expect(jobs[2]).toMatchObject({ nextRunAt: null, pausedReason: 'test job' });
  });

  it('never modifies the job files or run history', () => {
    const f = path.join(home, 'profiles/clerk/cron/executions.db');
    const before = fs.readFileSync(f);
    readJobs(home, profiles, NOW);
    expect(fs.readFileSync(f).equals(before)).toBe(true);
  });
});

describe('scheduled jobs in the status model', () => {
  const snap = () => ({
    generatedAt: NOW, profiles, tasks: [], homes: [], homeId: 'test', board: null,
    activity: profiles.map(p => ({ profileId: p.id, working: false, step: null, current: null, lastTurn: null, lastActiveAt: null, chats24h: 0, recent: [] })),
    jobs: readJobs(home, profiles, NOW),
  }) as unknown as HermesSnapshot;

  it('words each job state and finds the next run', () => {
    const s = snap();
    expect(s.jobs!.map(j => jobTone(j).key)).toEqual(['hermes.sched.scheduled', 'hermes.sched.failed', 'hermes.sched.paused']);
    expect(nextJob(s)?.name).toBe('Time check');
  });

  it('adds the next job and failing jobs to the team summary, and flags the agent', () => {
    const sum = teamSummary(snap(), k => k);
    expect(sum.schedule).toMatchObject({ next: { agent: 'clerk', name: 'Time check' }, total: 3, failing: 1, running: 0 });
    expect(sum.agents.find(a => a.id === 'clerk')?.alert).toBe('job failed');
  });
});
