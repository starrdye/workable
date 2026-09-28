/**
 * edit/apply.ts — run an approved plan. Checks nothing changed since the
 * preview, backs up every guarded file, then runs the steps in order and
 * stops at the first failure.
 *
 * Writes are confined to HERMES_HOME and the plan's staging folder; every
 * other change goes through the hermes CLI.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import type { EditPlan } from './plan';
import { sha } from './plan';

export interface StepResult { label: string; ok: boolean; output: string }
export interface ApplyResult { ok: boolean; steps: StepResult[]; backupDir: string | null; error?: string }

const STEP_TIMEOUT_MS = 180_000;

export function resolveHermesBin(): string {
  if (process.env.HERMES_BIN?.trim()) return process.env.HERMES_BIN.trim();
  const local = path.join(os.homedir(), '.local', 'bin', 'hermes');
  return fs.existsSync(local) ? local : 'hermes';
}

function inside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function tail(s: string, n = 1500): string {
  const t = s.trim();
  return t.length > n ? '…' + t.slice(-n) : t;
}

export type HermesRunner = (args: string[], home: string) => Promise<{ code: number; output: string }>;

export const runHermes: HermesRunner = (args, home) =>
  new Promise(resolve => {
    const env = { ...process.env, HERMES_HOME: home, PATH: `${path.join(os.homedir(), '.local', 'bin')}:${process.env.PATH ?? ''}` };
    execFile(resolveHermesBin(), args, { env, timeout: STEP_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as NodeJS.ErrnoException & { code?: unknown }).code === 'number' ? (err as unknown as { code: number }).code : 1) : 0;
      resolve({ code, output: `${stdout}${stderr ? `\n${stderr}` : ''}${err && !stdout && !stderr ? err.message : ''}` });
    });
  });

export async function applyPlan(plan: EditPlan, currentHome: string, run: HermesRunner = runHermes): Promise<ApplyResult> {
  if (path.resolve(plan.home) !== path.resolve(currentHome)) {
    return { ok: false, steps: [], backupDir: null, error: `This preview was made for ${plan.home}, but Workable now points at ${currentHome}. Preview again.` };
  }

  for (const g of plan.guards) {
    const now = fs.existsSync(g.path) ? (fs.statSync(g.path).isDirectory() ? 'dir' : sha(g.path)) : null;
    if (now !== g.sha) {
      return { ok: false, steps: [], backupDir: null, error: `${g.path} ${g.sha === null ? 'now exists' : 'changed'} since the preview. Preview again.` };
    }
  }

  // Back up every guarded file that exists.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(plan.home, 'backups', 'workable', stamp);
  const toBackup = plan.guards.filter(g => g.sha && fs.existsSync(g.path));
  for (const g of toBackup) {
    const dest = path.join(backupDir, path.relative(plan.home, g.path));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(g.path, dest);
  }

  const results: StepResult[] = [];
  try {
    for (const step of plan.steps) {
      if (step.kind === 'write' || step.kind === 'mkdir') {
        const allowed = inside(step.path, plan.home) || (!!plan.stagingDir && inside(step.path, plan.stagingDir));
        if (!allowed) {
          results.push({ label: step.label, ok: false, output: `Refused: ${step.path} is outside ${plan.home}.` });
          return { ok: false, steps: results, backupDir: toBackup.length ? backupDir : null };
        }
        if (step.kind === 'mkdir') fs.mkdirSync(step.path, { recursive: true });
        else {
          fs.mkdirSync(path.dirname(step.path), { recursive: true });
          fs.writeFileSync(step.path, step.content);
        }
        results.push({ label: step.label, ok: true, output: step.path });
        continue;
      }
      const { code, output } = await run(step.args, plan.home);
      results.push({ label: step.label, ok: code === 0, output: tail(output) });
      if (code !== 0) return { ok: false, steps: results, backupDir: toBackup.length ? backupDir : null };
    }
    return { ok: true, steps: results, backupDir: toBackup.length ? backupDir : null };
  } finally {
    if (plan.stagingDir && inside(plan.stagingDir, os.tmpdir())) fs.rmSync(plan.stagingDir, { recursive: true, force: true });
  }
}
