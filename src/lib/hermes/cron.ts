/**
 * hermes/cron.ts — Read-only view of Hermes scheduled jobs (`hermes cron`).
 *
 * Each profile keeps its own jobs in <profile>/cron/jobs.json, run history in
 * cron/executions.db and each run's saved output in cron/output/<job>/*.md.
 * Nothing here writes; the executions DB is opened { readonly: true }.
 */

import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import type { HermesJob, HermesProfile } from './types';

export function cronDir(home: string, profile: HermesProfile): string {
  return path.join(profile.isDefault ? home : path.join(home, 'profiles', profile.id), 'cron');
}

const toUnix = (iso: unknown): number | null => {
  if (typeof iso !== 'string' || !iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
};

const DAYS = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
const pad = (n: string) => n.padStart(2, '0');

/** A schedule in plain words; falls back to Hermes's own display text. */
export function describeSchedule(schedule: unknown, display: string): string {
  const s = (schedule && typeof schedule === 'object' ? schedule : {}) as Record<string, unknown>;
  if (s.kind === 'interval' && typeof s.minutes === 'number') {
    const m = s.minutes;
    if (m % 1440 === 0) return m === 1440 ? 'Every day' : `Every ${m / 1440} days`;
    if (m % 60 === 0) return m === 60 ? 'Every hour' : `Every ${m / 60} h`;
    return `Every ${m} min`;
  }
  const expr = typeof s.expr === 'string' ? s.expr.trim() : /^[\d*/,-]+( [\d*/,-]+){4}$/.test(display) ? display : '';
  const parts = expr.split(/\s+/);
  if (parts.length === 5) {
    const [min, hour, dom, mon, dow] = parts;
    const at = /^\d+$/.test(min) && /^\d+$/.test(hour) ? `${pad(hour)}:${pad(min)}` : null;
    const everyMin = min.match(/^\*\/(\d+)$/);
    if (everyMin && hour === '*' && dom === '*' && mon === '*' && dow === '*') return `Every ${everyMin[1]} min`;
    const everyHour = hour.match(/^\*\/(\d+)$/);
    if (/^\d+$/.test(min) && everyHour && dom === '*' && mon === '*' && dow === '*') return `Every ${everyHour[1]} h`;
    if (at && dom === '*' && mon === '*') {
      if (dow === '*') return `Daily at ${at}`;
      if (dow === '1-5') return `Weekdays at ${at}`;
      if (dow === '0,6' || dow === '6,0') return `Weekends at ${at}`;
      if (/^[0-6]$/.test(dow)) return `${DAYS[Number(dow)]} at ${at}`;
    }
    if (at && /^\d+$/.test(dom) && mon === '*' && dow === '*') return `Monthly on day ${dom} at ${at}`;
  }
  return display || 'Custom schedule';
}

/** First line of the "## Response" section in a run's saved output. */
function lastReply(dir: string, jobId: string): string | null {
  const out = path.join(dir, 'output', jobId);
  try {
    const newest = fs.readdirSync(out).filter(f => f.endsWith('.md')).sort().pop();
    if (!newest) return null;
    const text = fs.readFileSync(path.join(out, newest), 'utf8');
    const idx = text.lastIndexOf('## Response');
    if (idx < 0) return null;
    const line = text.slice(idx + '## Response'.length).split('\n').map(l => l.trim()).find(Boolean) ?? null;
    return line && line !== '[SILENT]' ? line.slice(0, 200) : null;
  } catch {
    return null;
  }
}

interface ExecRow { job_id: string; status: string; claimed_at: string; started_at: string | null; finished_at: string | null }

function readRuns(dir: string): Map<string, HermesJob['runs']> {
  const runs = new Map<string, HermesJob['runs']>();
  const file = path.join(dir, 'executions.db');
  if (!fs.existsSync(file)) return runs;
  let db: Database.Database | null = null;
  try {
    db = new Database(file, { readonly: true, fileMustExist: true });
    const rows = db.prepare(`SELECT job_id, status, claimed_at, started_at, finished_at FROM executions
      ORDER BY claimed_at DESC LIMIT 400`).all() as ExecRow[];
    for (const r of rows) {
      const list = runs.get(r.job_id) ?? [];
      if (list.length >= 8) continue;
      const status = r.status === 'completed' ? 'completed' : r.status === 'failed' ? 'failed'
        : r.status === 'running' || r.status === 'claimed' ? 'running' : 'other';
      list.push({ at: toUnix(r.finished_at ?? r.started_at ?? r.claimed_at) ?? 0, status });
      runs.set(r.job_id, list);
    }
  } catch {
    // An unreadable history just means no dots.
  } finally {
    db?.close();
  }
  return runs;
}

/** A run still marked running after this long is treated as stale (the ticker died). */
const RUN_STALE_S = 2 * 3600;

export function readJobs(home: string, profiles: HermesProfile[], now: number): HermesJob[] {
  const jobs: HermesJob[] = [];
  for (const p of profiles) {
    const dir = cronDir(home, p);
    const file = path.join(dir, 'jobs.json');
    if (!fs.existsSync(file)) continue;
    let list: Record<string, unknown>[] = [];
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      list = Array.isArray(data) ? data : Array.isArray(data?.jobs) ? data.jobs : [];
    } catch {
      continue;
    }
    const runs = readRuns(dir);
    for (const j of list) {
      if (!j || typeof j.id !== 'string') continue;
      const history = runs.get(j.id) ?? [];
      const running = history[0]?.status === 'running' && now - history[0].at < RUN_STALE_S;
      const stored = String(j.state ?? '');
      const paused = stored === 'paused' || !!j.paused_at || j.enabled === false;
      const state: HermesJob['state'] = running ? 'running' : paused ? 'paused'
        : stored === 'error' || j.last_status === 'error' ? 'error' : stored === 'completed' ? 'completed' : 'scheduled';
      const display = typeof j.schedule_display === 'string' ? j.schedule_display : '';
      jobs.push({
        id: j.id,
        profileId: p.id,
        name: (typeof j.name === 'string' && j.name.trim()) || j.id,
        scheduleText: describeSchedule(j.schedule, display),
        state,
        nextRunAt: paused ? null : toUnix(j.next_run_at),
        lastRunAt: toUnix(j.last_run_at),
        lastStatus: j.last_status === 'ok' ? 'ok' : j.last_status === 'error' ? 'error' : null,
        lastError: typeof j.last_error === 'string' ? j.last_error.split('\n')[0].slice(0, 200) : null,
        pausedReason: typeof j.paused_reason === 'string' ? j.paused_reason : null,
        lastReply: lastReply(dir, j.id),
        runs: history,
      });
    }
  }
  // Soonest first; paused and finished jobs at the end.
  return jobs.sort((a, b) => (a.nextRunAt ?? Infinity) - (b.nextRunAt ?? Infinity));
}
