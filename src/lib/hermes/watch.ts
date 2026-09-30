/**
 * hermes/watch.ts — notice Hermes writes the moment they happen.
 *
 * Watches the folders that hold each profile's session store and the kanban
 * boards (WAL writes land in *-wal files), plus profile config. Many
 * listeners share one watcher set per install; it closes when the last
 * listener leaves. Nothing here reads or writes Hermes data.
 */

import fs from 'fs';
import path from 'path';

const RELEVANT = /(state\.db|kanban\.db|projects\.db|profile\.yaml|config\.yaml|SOUL\.md|board\.json|^current$)/;
const DEBOUNCE_MS = 120;

type Listener = () => void;

interface WatchSet {
  watchers: fs.FSWatcher[];
  listeners: Set<Listener>;
  timer: ReturnType<typeof setTimeout> | null;
  rescan: ReturnType<typeof setInterval> | null;
  dirs: Set<string>;
}

const g = globalThis as typeof globalThis & { __workableHermesWatch?: Map<string, WatchSet> };
const sets = (g.__workableHermesWatch ??= new Map<string, WatchSet>());

/** Folders worth watching for one install. */
export function watchDirs(home: string): string[] {
  const dirs = [home, path.join(home, 'profiles'), path.join(home, 'kanban'), path.join(home, 'kanban', 'boards')];
  for (const parent of [path.join(home, 'profiles'), path.join(home, 'kanban', 'boards')]) {
    try {
      for (const d of fs.readdirSync(parent, { withFileTypes: true })) if (d.isDirectory()) dirs.push(path.join(parent, d.name));
    } catch { /* folder not there yet */ }
  }
  // Scheduled jobs: each profile's cron folder (jobs.json, executions.db-wal).
  for (const d of [...dirs]) if (d === home || path.dirname(d) === path.join(home, 'profiles')) dirs.push(path.join(d, 'cron'));
  return dirs.filter(d => fs.existsSync(d));
}

function fire(set: WatchSet) {
  if (set.timer) return;
  set.timer = setTimeout(() => {
    set.timer = null;
    for (const l of set.listeners) {
      try { l(); } catch { /* a broken listener must not stop the others */ }
    }
  }, DEBOUNCE_MS);
}

function attach(set: WatchSet, dir: string) {
  if (set.dirs.has(dir)) return;
  try {
    const w = fs.watch(dir, { persistent: false }, (_event, file) => {
      const name = file ? String(file) : '';
      if (!name || RELEVANT.test(name)) fire(set);
    });
    w.on('error', () => { /* folder removed; the rescan re-attaches if it comes back */ });
    set.watchers.push(w);
    set.dirs.add(dir);
  } catch { /* unreadable folder — skip */ }
}

/** Call `onChange` (debounced) whenever Hermes writes to this install. Returns an unsubscribe. */
export function watchHermes(home: string, onChange: Listener): () => void {
  const key = path.resolve(home);
  let set = sets.get(key);
  if (!set) {
    const created: WatchSet = { watchers: [], listeners: new Set(), timer: null, dirs: new Set(), rescan: null };
    // New profiles and boards appear as new folders; pick them up.
    created.rescan = setInterval(() => watchDirs(key).forEach(d => attach(created, d)), 5000);
    watchDirs(key).forEach(d => attach(created, d));
    sets.set(key, created);
    set = created;
  }
  set.listeners.add(onChange);
  return () => {
    const s = sets.get(key);
    if (!s) return;
    s.listeners.delete(onChange);
    if (s.listeners.size === 0) {
      s.watchers.forEach(w => w.close());
      if (s.rescan) clearInterval(s.rescan);
      if (s.timer) clearTimeout(s.timer);
      sets.delete(key);
    }
  };
}
