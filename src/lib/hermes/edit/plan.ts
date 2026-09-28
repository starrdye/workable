/**
 * edit/plan.ts — turn an edit request from the canvas into a reviewable plan:
 * the file changes to show as a diff, and the exact steps apply will run.
 *
 * Building a plan never writes anything. Plans are held in memory for 30
 * minutes and applied at most once.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { parse as parseYaml, stringify as toYaml } from 'yaml';
import { readBoards, readProfiles, readProjects } from '../roster';
import { addTeamRow, buildWorkerSoul, type WorkerTemplate } from './soul';
import type { EditPlanView } from '../types';

export type EditOp = 'add-agent' | 'edit-agent' | 'add-project';

export interface FileChange {
  /** Absolute path, or a label for things that aren't files (e.g. "board: research"). */
  path: string;
  label: string;
  before: string;
  after: string;
}

export type PlanStep =
  | { kind: 'write'; label: string; path: string; content: string }
  | { kind: 'mkdir'; label: string; path: string }
  | { kind: 'hermes'; label: string; args: string[] };

export interface EditPlan {
  id: string;
  op: EditOp;
  title: string;
  home: string;
  createdAt: number;
  changes: FileChange[];
  steps: PlanStep[];
  warnings: string[];
  /** Files that must be unchanged at apply time (sha256, or null = must not exist). Also backed up. */
  guards: Array<{ path: string; sha: string | null }>;
  /** Scratch directory the plan stages files in; removed after apply. */
  stagingDir: string | null;
}

export class PlanError extends Error {}

const PLAN_TTL_MS = 30 * 60 * 1000;
// On globalThis so /api/hermes/plan and /api/hermes/apply share it even when bundled separately.
const g = globalThis as typeof globalThis & { __workableHermesPlans?: Map<string, EditPlan> };
const plans = (g.__workableHermesPlans ??= new Map<string, EditPlan>());

export function storePlan(plan: EditPlan): EditPlan {
  const now = Date.now();
  for (const [id, p] of plans) if (now - p.createdAt > PLAN_TTL_MS) plans.delete(id);
  plans.set(plan.id, plan);
  return plan;
}

/** Take a plan out of the store (single use). */
export function takePlan(id: string): EditPlan | null {
  const p = plans.get(id);
  plans.delete(id);
  if (!p || Date.now() - p.createdAt > PLAN_TTL_MS) return null;
  return p;
}

export function sha(file: string): string | null {
  try { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); } catch { return null; }
}

function read(file: string): string {
  try { return fs.readFileSync(file, 'utf8'); } catch { return ''; }
}

function newPlan(op: EditOp, title: string, home: string): EditPlan {
  return { id: crypto.randomUUID(), op, title, home, createdAt: Date.now(), changes: [], steps: [], warnings: [], guards: [], stagingDir: null };
}

const PROFILE_ID = /^[a-z][a-z0-9-]{1,39}$/;
const SLUG = /^[a-z][a-z0-9-]{1,39}$/;
const MODEL = /^[\w.:/@-]{2,120}$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;

function clean(s: unknown, max: number): string {
  return typeof s === 'string' ? s.replace(/\r/g, '').trim().slice(0, max) : '';
}

/** Env var names a config.yaml references as ${NAME}. */
export function referencedEnvVars(configText: string): string[] {
  return [...new Set([...configText.matchAll(/\$\{([A-Z0-9_]+)\}/g)].map(m => m[1]))];
}

function profileDir(home: string, id: string): string {
  return id === 'default' ? home : path.join(home, 'profiles', id);
}

/** The first worker with a SOUL.md and config.yaml: new workers copy its rules and model wiring. */
function findTemplateWorker(home: string): { template: WorkerTemplate | null; config: Record<string, unknown> } {
  for (const p of readProfiles(home).filter(x => !x.isDefault)) {
    const dir = profileDir(home, p.id);
    const soul = read(path.join(dir, 'SOUL.md'));
    if (!soul) continue;
    let config: Record<string, unknown> = {};
    try { config = (parseYaml(read(path.join(dir, 'config.yaml'))) as Record<string, unknown>) ?? {}; } catch { /* keep empty */ }
    return { template: { id: p.id, soul }, config };
  }
  return { template: null, config: {} };
}

// ── add-agent ────────────────────────────────────────────────────────────────

export interface AddAgentInput {
  id: string;
  role: string;
  description: string;
  model: string;
  responsibilities: string;
  delivery?: string;
  /** What the orchestrator should send this worker (its team-table row). */
  giveIt?: string;
}

export function planAddAgent(home: string, raw: AddAgentInput): EditPlan {
  const input = {
    id: clean(raw.id, 40).toLowerCase(),
    role: clean(raw.role, 60),
    description: clean(raw.description, 300),
    model: clean(raw.model, 120),
    responsibilities: clean(raw.responsibilities, 2000),
    delivery: clean(raw.delivery, 2000),
    giveIt: clean(raw.giveIt, 200),
  };
  if (!PROFILE_ID.test(input.id) || input.id === 'default') throw new PlanError('Profile name: 2–40 characters, lowercase letters, digits and dashes, starting with a letter.');
  if (!input.role) throw new PlanError('Give the agent a role, e.g. "Editor".');
  if (!input.description) throw new PlanError('Add a one-line description. The orchestrator routes work on it.');
  if (!MODEL.test(input.model)) throw new PlanError('Model looks wrong. Use the id your provider expects, e.g. deepseek/deepseek-v4-flash.');
  if (!input.responsibilities) throw new PlanError('List at least one thing this agent does.');
  const profiles = readProfiles(home);
  if (profiles.some(p => p.id === input.id)) throw new PlanError(`A profile named "${input.id}" already exists.`);

  const plan = newPlan('add-agent', `Add agent ${input.id}`, home);
  const { template, config: templateConfig } = findTemplateWorker(home);
  const soul = buildWorkerSoul({ id: input.id, role: input.role, responsibilities: input.responsibilities, delivery: input.delivery }, template);

  // Reuse the template's provider wiring (provider, base_url, api_key reference); swap only the model.
  const tplModel = (templateConfig.model && typeof templateConfig.model === 'object') ? templateConfig.model as Record<string, unknown> : {};
  const modelBlock: Record<string, unknown> = { ...tplModel, default: input.model };
  if (!template) { modelBlock.provider = 'auto'; }
  const configYaml = [
    '# Created by Workable. Only the settings this role changes; everything else uses Hermes defaults.',
    toYaml({ model: modelBlock }).trim(),
    '',
    '# Workers never drive the desktop.',
    toYaml({ agent: { disabled_toolsets: ['computer_use'] } }).trim(),
    '',
  ].join('\n');
  const distribution = toYaml({
    name: input.id, version: '1.0.0', description: input.description,
    hermes_requires: '>=0.21.0', author: 'Workable', license: 'private',
  });

  const staging = path.join(os.tmpdir(), 'workable-hermes', plan.id, input.id);
  plan.stagingDir = path.dirname(staging);
  const finalDir = profileDir(home, input.id);
  plan.changes.push(
    { path: path.join(finalDir, 'SOUL.md'), label: `New profile · SOUL.md`, before: '', after: soul },
    { path: path.join(finalDir, 'config.yaml'), label: `New profile · config.yaml`, before: '', after: configYaml },
  );
  plan.steps.push(
    { kind: 'write', label: 'Stage distribution.yaml', path: path.join(staging, 'distribution.yaml'), content: distribution },
    { kind: 'write', label: 'Stage SOUL.md', path: path.join(staging, 'SOUL.md'), content: soul },
    { kind: 'write', label: 'Stage config.yaml', path: path.join(staging, 'config.yaml'), content: configYaml },
    { kind: 'hermes', label: 'Install the profile', args: ['profile', 'install', staging, '--name', input.id, '-y'] },
    { kind: 'hermes', label: 'Set its routing description', args: ['profile', 'describe', input.id, '--text', input.description] },
    { kind: 'hermes', label: 'Keep desktop control off', args: ['-p', input.id, 'config', 'set', 'agent.disabled_toolsets', '["computer_use"]'] },
  );
  plan.guards.push({ path: finalDir, sha: null });

  // Tell the orchestrator about its new worker.
  const orchSoulPath = path.join(home, 'SOUL.md');
  const orchSoul = read(orchSoulPath);
  const shortModel = input.model.split('/').pop();
  const updated = orchSoul ? addTeamRow(orchSoul, { id: input.id, role: `${input.role} (${shortModel})`, giveIt: input.giveIt || input.description }) : null;
  if (updated && updated !== orchSoul) {
    plan.changes.push({ path: orchSoulPath, label: 'Orchestrator · SOUL.md (team table)', before: orchSoul, after: updated });
    plan.steps.push({ kind: 'write', label: 'Add the worker to the orchestrator\'s team table', path: orchSoulPath, content: updated });
    plan.guards.push({ path: orchSoulPath, sha: sha(orchSoulPath) });
  } else if (!updated) {
    plan.warnings.push('Couldn\'t find a "| Profile | Role | Give it |" table in the orchestrator\'s SOUL.md. Add the new worker there by hand so the orchestrator knows to use it.');
  }

  if (!template) plan.warnings.push('No existing worker to copy rules from, so the standard rules block is used.');
  const vars = referencedEnvVars(configYaml);
  if (vars.length) {
    plan.warnings.push(`The new profile needs its own ${vars.join(', ')}. Workable doesn't copy secrets: after applying, run  hermes -p ${input.id} config set ${vars[0]} <key>`);
  } else if (input.model.includes('/')) {
    plan.warnings.push(`If this model is served through OpenRouter, the profile needs OPENROUTER_API_KEY: hermes -p ${input.id} config set OPENROUTER_API_KEY <key>`);
  }
  return storePlan(plan);
}

// ── edit-agent ───────────────────────────────────────────────────────────────

export interface EditAgentInput { id: string; description?: string; model?: string }

export function planEditAgent(home: string, raw: EditAgentInput): EditPlan {
  const id = clean(raw.id, 40);
  const profile = readProfiles(home).find(p => p.id === id);
  if (!profile) throw new PlanError(`No profile named "${id}".`);
  const description = raw.description === undefined ? profile.description : clean(raw.description, 300);
  const model = raw.model === undefined ? (profile.model ?? '') : clean(raw.model, 120);
  if (!description) throw new PlanError('The description can\'t be empty. The orchestrator routes work on it.');
  if (model && !MODEL.test(model)) throw new PlanError('Model looks wrong. Use the id your provider expects.');

  const plan = newPlan('edit-agent', `Edit ${profile.name}`, home);
  const dir = profileDir(home, id);
  const scope = id === 'default' ? [] : ['-p', id];
  if (description !== profile.description) {
    plan.changes.push({ path: path.join(dir, 'profile.yaml'), label: `${profile.name} · description`, before: profile.description, after: description });
    plan.steps.push({ kind: 'hermes', label: 'Update the routing description', args: ['profile', 'describe', id, '--text', description] });
    plan.guards.push({ path: path.join(dir, 'profile.yaml'), sha: sha(path.join(dir, 'profile.yaml')) });
  }
  if (model && model !== profile.model) {
    plan.changes.push({ path: path.join(dir, 'config.yaml'), label: `${profile.name} · model.default`, before: profile.model ?? '', after: model });
    plan.steps.push({ kind: 'hermes', label: 'Switch the model', args: [...scope, 'config', 'set', 'model.default', model] });
    plan.guards.push({ path: path.join(dir, 'config.yaml'), sha: sha(path.join(dir, 'config.yaml')) });
  }
  if (!plan.steps.length) throw new PlanError('Nothing changed.');
  if (profile.isDefault && model && model !== profile.model) plan.warnings.push('This changes the orchestrator\'s model, which every conversation with it uses.');
  return storePlan(plan);
}

// ── add-project ──────────────────────────────────────────────────────────────

export interface AddProjectInput { name: string; slug: string; description?: string; color?: string }

export function planAddProject(home: string, raw: AddProjectInput): EditPlan {
  const name = clean(raw.name, 60);
  const slug = clean(raw.slug, 40).toLowerCase();
  const description = clean(raw.description, 200);
  const color = clean(raw.color, 7);
  if (!name) throw new PlanError('Give the project a name.');
  if (!SLUG.test(slug)) throw new PlanError('Short name: 2–40 characters, lowercase letters, digits and dashes, starting with a letter.');
  if (color && !COLOR.test(color)) throw new PlanError('Colour must look like #6366F1.');
  if (readBoards(home).some(b => b.slug === slug)) throw new PlanError(`A board named "${slug}" already exists.`);
  if (readProjects(home).some(p => p.slug === slug)) throw new PlanError(`A project named "${slug}" already exists.`);

  const plan = newPlan('add-project', `Add project ${name}`, home);
  const workdir = path.join(home, 'work', slug);
  const optional = (flag: string, v: string) => (v ? [flag, v] : []);
  plan.changes.push(
    { path: `board: ${slug}`, label: 'New kanban board', before: '', after: toYaml({ slug, name, description: description || undefined, color: color || undefined, default_workdir: workdir }) },
    { path: `project: ${slug}`, label: 'New project', before: '', after: toYaml({ name, slug, description: description || undefined, board: slug, folders: [workdir] }) },
  );
  plan.steps.push(
    { kind: 'mkdir', label: 'Create the board\'s working folder', path: workdir },
    { kind: 'hermes', label: 'Create the board', args: ['kanban', 'boards', 'create', slug, '--name', name, ...optional('--description', description), ...optional('--color', color), '--default-workdir', workdir] },
    { kind: 'hermes', label: 'Create the project and bind the board', args: ['project', 'create', name, '--slug', slug, ...optional('--description', description), ...optional('--color', color), '--board', slug, workdir] },
  );
  plan.warnings.push('A board separates work, not memory: profiles that take cards from several boards still carry context between them.');
  return storePlan(plan);
}

function shellQuote(a: string): string {
  return /^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`;
}

export function toPlanView(plan: EditPlan): EditPlanView {
  return {
    id: plan.id, op: plan.op, title: plan.title, home: plan.home, changes: plan.changes, warnings: plan.warnings,
    steps: plan.steps.map(s => ({
      label: s.label,
      command: s.kind === 'hermes' ? `hermes ${s.args.map(shellQuote).join(' ')}`
        : s.kind === 'mkdir' ? `mkdir -p ${shellQuote(s.path)}` : `write ${shellQuote(s.path)}`,
    })),
  };
}
