/**
 * hermes/roster.ts — Read-only view of a Hermes install on disk.
 *
 * Resolves HERMES_HOME, lists boards / projects, and turns profiles into
 * HermesProfile records. Nothing in this file writes to HERMES_HOME.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { parse as parseYaml } from 'yaml';
import Database from 'better-sqlite3';
import type { HermesBoard, HermesHomeOption, HermesProfile, HermesProject } from './types';

export function resolveHermesHome(): string {
  const fromEnv = process.env.HERMES_HOME?.trim();
  if (fromEnv) return fromEnv.startsWith('~') ? path.join(os.homedir(), fromEnv.slice(1)) : fromEnv;
  return path.join(os.homedir(), '.hermes');
}

function expandHome(p: string): string {
  const t = p.trim();
  return t.startsWith('~') ? path.join(os.homedir(), t.slice(1)) : t;
}

/**
 * Installs the view can switch between. HERMES_HOME (the primary, and the only
 * one edits may change) comes first; WORKABLE_HERMES_HOMES adds more, as
 * "label=path" or plain paths, comma-separated.
 */
export function resolveHermesHomes(): HermesHomeOption[] {
  const out: HermesHomeOption[] = [];
  const add = (label: string, p: string) => {
    const abs = path.resolve(expandHome(p));
    if (!abs) return;
    const existing = out.find(h => h.path === abs);
    if (existing) { // a label in WORKABLE_HERMES_HOMES renames an install already listed
      existing.label = label;
      existing.id = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || existing.id;
      return;
    }
    let id = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'hermes';
    while (out.some(h => h.id === id)) id += '-2';
    out.push({ id, label, path: abs });
  };
  const nameOf = (p: string) => path.basename(expandHome(p)).replace(/^\./, '') || 'hermes';
  const primary = resolveHermesHome();
  add(nameOf(primary), primary);
  for (const entry of (process.env.WORKABLE_HERMES_HOMES ?? '').split(',').map(e => e.trim()).filter(Boolean)) {
    const eq = entry.indexOf('=');
    if (eq > 0) add(entry.slice(0, eq).trim(), entry.slice(eq + 1));
    else add(nameOf(entry), entry);
  }
  return out;
}

function readYaml(file: string): Record<string, unknown> {
  try {
    const doc = parseYaml(fs.readFileSync(file, 'utf8'));
    return doc && typeof doc === 'object' ? (doc as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** model.default (or model.model, or a bare string) from a Hermes config.yaml. */
function readModel(config: Record<string, unknown>): string | null {
  const m = config.model;
  if (typeof m === 'string') return m.trim() || null;
  if (m && typeof m === 'object') {
    const rec = m as Record<string, unknown>;
    return str(rec.default) || str(rec.model) || null;
  }
  return null;
}

function readDisabledToolsets(config: Record<string, unknown>): string[] {
  const agent = config.agent as Record<string, unknown> | undefined;
  const list = agent?.disabled_toolsets;
  return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [];
}

function toProfile(id: string, dir: string, isDefault: boolean): HermesProfile {
  const meta = readYaml(path.join(dir, 'profile.yaml'));
  const config = readYaml(path.join(dir, 'config.yaml'));
  const disabled = readDisabledToolsets(config);
  return {
    id,
    name: (isDefault && str(meta.display_name)) || id,
    description: str(meta.description),
    model: readModel(config),
    isDefault,
    unattended: disabled.includes('computer_use'),
    disabledToolsets: disabled,
  };
}

/** The default profile first, then named profiles alphabetically. */
export function readProfiles(home: string): HermesProfile[] {
  const profiles: HermesProfile[] = [];
  if (fs.existsSync(path.join(home, 'config.yaml')) || fs.existsSync(path.join(home, 'profile.yaml'))) {
    profiles.push(toProfile('default', home, true));
  }
  const dir = path.join(home, 'profiles');
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir, { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.name.startsWith('.'))
      .map(d => d.name)
      .sort();
  } catch { /* no named profiles */ }
  for (const name of names) profiles.push(toProfile(name, path.join(dir, name), false));
  return profiles;
}

export function readBoards(home: string): HermesBoard[] {
  const dir = path.join(home, 'kanban', 'boards');
  let slugs: string[] = [];
  try {
    slugs = fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort();
  } catch { return []; }
  return slugs.flatMap(slug => {
    let meta: Record<string, unknown> = {};
    try { meta = JSON.parse(fs.readFileSync(path.join(dir, slug, 'board.json'), 'utf8')); } catch { /* use defaults */ }
    if (meta.archived === true) return [];
    return [{
      slug,
      name: str(meta.name) || slug,
      description: str(meta.description),
      projectId: str(meta.project_id) || null,
    }];
  });
}

/** Board Hermes treats as current (kanban/current), falling back to the first board. */
export function readCurrentBoardSlug(home: string, boards: HermesBoard[]): string | null {
  try {
    const slug = fs.readFileSync(path.join(home, 'kanban', 'current'), 'utf8').trim();
    if (slug && boards.some(b => b.slug === slug)) return slug;
  } catch { /* fall through */ }
  return boards[0]?.slug ?? null;
}

/** Path to a board's kanban.db. Boards live under kanban/boards/<slug>/; the root kanban.db is the legacy board. */
export function boardDbPath(home: string, slug: string | null): string | null {
  if (slug) {
    const p = path.join(home, 'kanban', 'boards', slug, 'kanban.db');
    if (fs.existsSync(p)) return p;
  }
  const legacy = path.join(home, 'kanban.db');
  return fs.existsSync(legacy) ? legacy : null;
}

export function readProjects(home: string): HermesProject[] {
  const file = path.join(home, 'projects.db');
  if (!fs.existsSync(file)) return [];
  let db: Database.Database | null = null;
  try {
    db = new Database(file, { readonly: true, fileMustExist: true });
    const rows = db.prepare(
      'SELECT id, slug, name, color, board_slug FROM projects WHERE archived = 0 ORDER BY name'
    ).all() as Array<{ id: string; slug: string; name: string; color: string | null; board_slug: string | null }>;
    return rows.map(r => ({ id: r.id, slug: r.slug, name: r.name, color: r.color || null, boardSlug: r.board_slug || null }));
  } catch {
    return [];
  } finally {
    db?.close();
  }
}
