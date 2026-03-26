/**
 * db/schema.ts — SQLite schema for Workable distributed state.
 * Phase 1: Graph database foundation.
 *
 * Tables mirror the TypeScript interfaces in serverState.ts exactly so the
 * adapter can round-trip ServerGraphState without lossy conversions.
 */

export const SCHEMA_SQL = `
-- ─── Nodes ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nodes (
  id             TEXT PRIMARY KEY,
  label          TEXT NOT NULL,
  label_initials TEXT NOT NULL DEFAULT '',
  node_type      TEXT NOT NULL DEFAULT 'neural',    -- 'neural' | 'eco'
  role           TEXT NOT NULL DEFAULT 'person',     -- 'person' | 'tool' | 'external' | 'output'
  source         TEXT,                               -- 'ai-generated' | 'user-added' | null
  text_color     TEXT,
  output_delay   REAL
);

-- ─── Edges ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS edges (
  id                  TEXT PRIMARY KEY,
  source              TEXT NOT NULL,
  target              TEXT NOT NULL,
  sequence            INTEGER,
  weight              REAL DEFAULT 1.0,
  is_custom           INTEGER DEFAULT 0,        -- boolean
  is_improvement_only INTEGER DEFAULT 0,         -- boolean
  name                TEXT,
  curve_tension       REAL,
  z_layer             INTEGER
);

-- ─── Positions ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS positions (
  node_id     TEXT NOT NULL,
  view        TEXT NOT NULL,             -- 'baseline' | 'ecosystem'
  x           REAL NOT NULL DEFAULT 0,
  y           REAL NOT NULL DEFAULT 0,
  z           REAL,
  is_original INTEGER DEFAULT 0,         -- boolean: 1 = original snapshot position
  PRIMARY KEY (node_id, view, is_original)
);

-- ─── Groups ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS groups_ (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  color           TEXT NOT NULL DEFAULT '#6366F1',
  parent_group_id TEXT
);

CREATE TABLE IF NOT EXISTS group_members (
  group_id TEXT NOT NULL,
  node_id  TEXT NOT NULL,
  PRIMARY KEY (group_id, node_id)
);

-- ─── Metadata Overrides ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS metadata (
  node_id      TEXT PRIMARY KEY,
  name         TEXT,
  role         TEXT,
  status       TEXT,
  status_color TEXT,
  summary      TEXT,
  constraints  TEXT,
  processes    TEXT,             -- JSON array
  connections  TEXT              -- JSON array
);

-- ─── Node Tasks ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS node_tasks (
  id       TEXT PRIMARY KEY,
  node_id  TEXT NOT NULL,
  title    TEXT NOT NULL,
  status   TEXT NOT NULL DEFAULT 'todo',
  priority TEXT NOT NULL DEFAULT 'medium',
  due_date TEXT,
  note     TEXT
);

-- ─── Settings (key-value) ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL               -- JSON-encoded
);

-- ─── Indexes ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_edges_source  ON edges(source);
CREATE INDEX IF NOT EXISTS idx_edges_target  ON edges(target);
CREATE INDEX IF NOT EXISTS idx_positions_view ON positions(view);
CREATE INDEX IF NOT EXISTS idx_group_members_node ON group_members(node_id);
CREATE INDEX IF NOT EXISTS idx_node_tasks_node ON node_tasks(node_id);
`;
