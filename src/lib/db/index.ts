/**
 * db/index.ts — SQLite database singleton.
 * Phase 1: Graph database foundation.
 *
 * Uses better-sqlite3 (synchronous) to match the existing serverState.ts API
 * which is entirely synchronous. The database file lives at data/workable.db
 * (gitignored) and is created automatically on first access.
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { SCHEMA_SQL } from './schema';

let _db: Database.Database | null = null;

/**
 * Get (or create) the singleton database connection.
 * Thread-safe: better-sqlite3 serialises all writes automatically.
 */
export function getDb(): Database.Database {
  if (_db) return _db;

  const dataDir = path.join(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const dbPath = path.join(dataDir, 'workable.db');
  _db = new Database(dbPath);

  // Performance settings for a single-server setup
  _db.pragma('journal_mode = WAL');         // faster concurrent reads
  _db.pragma('synchronous = NORMAL');       // safe for WAL mode
  _db.pragma('foreign_keys = ON');

  // Create tables
  _db.exec(SCHEMA_SQL);

  return _db;
}

/**
 * Close the database connection. Used in tests and graceful shutdown.
 */
export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

// Survive Next.js hot reloads in development
declare global {
  // eslint-disable-next-line no-var
  var __workableDb: Database.Database | undefined;
}

if (process.env.NODE_ENV === 'development' && global.__workableDb) {
  _db = global.__workableDb;
}

// After first init, persist reference for hot reload
export function persistDbRef(): void {
  if (_db && process.env.NODE_ENV === 'development') {
    global.__workableDb = _db;
  }
}
