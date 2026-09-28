// src/__tests__/hermes-edit.test.ts
// Hermes plugin phase 3: previews and applies edits against a fake
// HERMES_HOME in a temp dir, with a recording stand-in for the hermes CLI.

import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { lineDiff, withContext } from '@/lib/hermes/edit/diff';
import { addTeamRow, buildWorkerSoul, extractRules, FALLBACK_RULES } from '@/lib/hermes/edit/soul';
import { PlanError, planAddAgent, planAddProject, planEditAgent, referencedEnvVars, takePlan, toPlanView } from '@/lib/hermes/edit/plan';
import { applyPlan, type HermesRunner } from '@/lib/hermes/edit/apply';

const WORKER_SOUL = `You are **clerk**, the Clerk on the Test team. You report to **lead**, never to the human directly.

## What you do
- Pull data.

## Rules that always apply
- Never repeat credentials.
- Finish with \`kanban_complete\`.
`;

const ORCH_SOUL = `You are the lead.

## Your team
| Profile | Role | Give it |
|---|---|---|
| \`clerk\` | Clerk (flash) | Data pulls |

## Hard rules
1. No trades.
`;

let home: string;

function write(file: string, content: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-edit-'));
  write(path.join(home, 'config.yaml'), 'model:\n  default: lead-model\n');
  write(path.join(home, 'profile.yaml'), 'display_name: lead\ndescription: Lead\n');
  write(path.join(home, 'SOUL.md'), ORCH_SOUL);
  write(path.join(home, 'profiles/clerk/SOUL.md'), WORKER_SOUL);
  write(path.join(home, 'profiles/clerk/profile.yaml'), 'description: Clerk work\n');
  write(path.join(home, 'profiles/clerk/config.yaml'), 'model:\n  default: ep-123\n  provider: custom\n  base_url: https://ark.example/api/v3\n  api_key: ${ARK_API_KEY}\n');
});

afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

/** Stand-in for the hermes CLI: records calls, fails on demand. */
function recorder(failOn?: string): { run: HermesRunner; calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    run: async (args, h) => {
      calls.push(args);
      expect(h).toBe(home);
      return failOn && args.includes(failOn) ? { code: 2, output: 'boom' } : { code: 0, output: 'ok' };
    },
  };
}

const addAgentInput = {
  id: 'editor', role: 'Editor', description: 'Tightens drafts', model: 'ep-123',
  responsibilities: 'Edit drafts for length\n- Fix tone', giveIt: 'Drafts that need editing',
};

describe('diff', () => {
  it('marks added and removed lines and collapses unchanged runs', () => {
    const d = lineDiff('a\nb\nc', 'a\nB\nc\nd');
    expect(d).toEqual([
      { kind: 'same', text: 'a' }, { kind: 'del', text: 'b' }, { kind: 'add', text: 'B' }, { kind: 'same', text: 'c' }, { kind: 'add', text: 'd' },
    ]);
    const long = Array.from({ length: 20 }, (_, i) => `l${i}`).join('\n');
    const rows = withContext(lineDiff(long, long.replace('l10', 'X')), 2);
    expect(rows[0]).toEqual({ kind: 'gap', count: 8 });
    expect(rows.filter(r => r.kind !== 'gap')).toHaveLength(6);
  });
});

describe('soul', () => {
  it('copies the rules block verbatim and re-points the intro line', () => {
    const soul = buildWorkerSoul({ id: 'editor', role: 'Editor', responsibilities: 'Edit drafts\n- Fix tone' }, { id: 'clerk', soul: WORKER_SOUL });
    expect(soul.split('\n')[0]).toBe('You are **editor**, the Editor on the Test team. You report to **lead**, never to the human directly.');
    expect(soul).toContain('- Edit drafts\n- Fix tone');
    expect(soul).toContain(extractRules(WORKER_SOUL)!);
    expect(buildWorkerSoul({ id: 'x1', role: 'X', responsibilities: 'y' }, null)).toContain(FALLBACK_RULES);
  });

  it('adds one row to the team table, once', () => {
    const next = addTeamRow(ORCH_SOUL, { id: 'editor', role: 'Editor', giveIt: 'Drafts | edits' })!;
    expect(next).toContain('| `clerk` | Clerk (flash) | Data pulls |\n| `editor` | Editor | Drafts / edits |\n\n## Hard rules');
    expect(addTeamRow(next, { id: 'editor', role: 'Editor', giveIt: 'x' })).toBe(next);
    expect(addTeamRow('no table here', { id: 'e', role: 'E', giveIt: 'x' })).toBeNull();
  });
});

describe('plans', () => {
  it('previews a new agent without writing anything', () => {
    const before = fs.readdirSync(path.join(home, 'profiles'));
    const plan = planAddAgent(home, addAgentInput);
    expect(fs.readdirSync(path.join(home, 'profiles'))).toEqual(before);
    expect(fs.readFileSync(path.join(home, 'SOUL.md'), 'utf8')).toBe(ORCH_SOUL);

    const config = plan.changes.find(c => c.path.endsWith('editor/config.yaml'))!.after;
    expect(config).toContain('default: ep-123');
    expect(config).toContain('base_url: https://ark.example/api/v3'); // provider wiring copied from the template worker
    expect(config).toContain('- computer_use');
    expect(plan.changes.find(c => c.label.includes('team table'))!.after).toContain('| `editor` | Editor (ep-123) | Drafts that need editing |');
    expect(plan.warnings.join(' ')).toContain('ARK_API_KEY');

    const view = toPlanView(plan);
    expect(view.steps.map(s => s.command)).toContain("hermes profile describe editor --text 'Tightens drafts'");
    expect(JSON.stringify(view)).not.toContain('guards');
  });

  it('rejects bad input with a message the user can act on', () => {
    expect(() => planAddAgent(home, { ...addAgentInput, id: 'Bad Name' })).toThrow(PlanError);
    expect(() => planAddAgent(home, { ...addAgentInput, id: 'clerk' })).toThrow(/already exists/);
    expect(() => planAddAgent(home, { ...addAgentInput, model: 'bad model!' })).toThrow(/Model/);
    expect(() => planEditAgent(home, { id: 'clerk', description: 'Clerk work' })).toThrow(/Nothing changed/);
    expect(() => planAddProject(home, { name: 'R', slug: 'x', color: 'red' })).toThrow(PlanError);
  });

  it('plans profile edits through the CLI, scoping worker config with -p', () => {
    const plan = planEditAgent(home, { id: 'clerk', description: 'Clerk: data only', model: 'ep-456' });
    expect(plan.steps.map(s => (s.kind === 'hermes' ? s.args : []))).toEqual([
      ['profile', 'describe', 'clerk', '--text', 'Clerk: data only'],
      ['-p', 'clerk', 'config', 'set', 'model.default', 'ep-456'],
    ]);
    const lead = planEditAgent(home, { id: 'default', model: 'other' });
    expect(lead.steps[0]).toMatchObject({ args: ['config', 'set', 'model.default', 'other'] });
    expect(lead.warnings[0]).toMatch(/orchestrator/);
  });

  it('plans a project with its own board and working folder', () => {
    const plan = planAddProject(home, { name: 'Research', slug: 'research', color: '#10B981' });
    const cmds = plan.steps.filter(s => s.kind === 'hermes').map(s => (s.kind === 'hermes' ? s.args.slice(0, 3).join(' ') : ''));
    expect(cmds).toEqual(['kanban boards create', 'project create Research']);
    expect(plan.steps[0]).toMatchObject({ kind: 'mkdir', path: path.join(home, 'work', 'research') });
  });

  it('finds ${VAR} references in config', () => {
    expect(referencedEnvVars('a: ${ARK_API_KEY}\nb: ${ARK_API_KEY} ${OTHER_1}')).toEqual(['ARK_API_KEY', 'OTHER_1']);
  });
});

describe('apply', () => {
  it('stages the profile, runs the CLI steps in order, updates the team table and backs it up', async () => {
    const plan = planAddAgent(home, addAgentInput);
    const { run, calls } = recorder();
    const res = await applyPlan(plan, home, run);
    expect(res.ok).toBe(true);
    expect(calls.map(c => c.slice(0, 2).join(' '))).toEqual(['profile install', 'profile describe', '-p editor']);
    expect(fs.readFileSync(path.join(home, 'SOUL.md'), 'utf8')).toContain('`editor`');
    expect(fs.readFileSync(path.join(res.backupDir!, 'SOUL.md'), 'utf8')).toBe(ORCH_SOUL);
    expect(fs.existsSync(plan.stagingDir!)).toBe(false); // staging cleaned up
  });

  it('refuses a stale preview', async () => {
    const plan = planAddAgent(home, addAgentInput);
    fs.appendFileSync(path.join(home, 'SOUL.md'), '\nedited by hand\n');
    const { run, calls } = recorder();
    const res = await applyPlan(plan, home, run);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/changed since the preview/);
    expect(calls).toEqual([]);
  });

  it('refuses a preview made for a different install', async () => {
    const plan = planAddProject(home, { name: 'Research', slug: 'research' });
    const res = await applyPlan(plan, '/somewhere/else', recorder().run);
    expect(res.error).toMatch(/Preview again/);
  });

  it('stops at the first failing step', async () => {
    const plan = planAddAgent(home, addAgentInput);
    const { run, calls } = recorder('describe');
    const res = await applyPlan(plan, home, run);
    expect(res.ok).toBe(false);
    expect(calls).toHaveLength(2);
    expect(res.steps.at(-1)).toMatchObject({ ok: false, output: 'boom' });
    expect(fs.readFileSync(path.join(home, 'SOUL.md'), 'utf8')).toBe(ORCH_SOUL); // later write never ran
  });

  it('never writes outside the install', async () => {
    const plan = planAddProject(home, { name: 'Research', slug: 'research' });
    plan.steps.unshift({ kind: 'write', label: 'evil', path: path.join(os.tmpdir(), 'outside.txt'), content: 'x' });
    const res = await applyPlan(plan, home, recorder().run);
    expect(res.ok).toBe(false);
    expect(res.steps[0].output).toMatch(/Refused/);
    expect(fs.existsSync(path.join(os.tmpdir(), 'outside.txt'))).toBe(false);
  });

  it('hands out each plan once', () => {
    const plan = planAddProject(home, { name: 'Research', slug: 'research' });
    expect(takePlan(plan.id)?.id).toBe(plan.id);
    expect(takePlan(plan.id)).toBeNull();
  });
});
