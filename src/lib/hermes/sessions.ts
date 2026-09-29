/**
 * hermes/sessions.ts — live chat activity from each profile's session store
 * (state.db). Direct chats (terminal, desktop app, messaging) never touch the
 * kanban board, so this is how Workable sees an agent answering you.
 *
 * Read-only: every database is opened { readonly: true } and closed at once.
 * Only titles, timestamps, roles and tool names are read, never message text.
 */

import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import type { ChatSession, HermesEvent, HermesProfile, ProfileActivity } from './types';
import { HUMAN_ID } from './metrics';

/** A turn with no new message for this long is treated as abandoned, not working. */
export const TURN_STALE_S = 10 * 60;
/** Chats older than this are left out. */
export const ACTIVITY_WINDOW_S = 24 * 3600;
/** Chat messages newer than this become events (ticker + pulses). */
export const CHAT_EVENT_WINDOW_S = 30 * 60;

interface SessionRow {
  id: string; source: string; title: string | null; started_at: number; last_at: number;
  message_count: number; ended_at: number | null;
}
interface LastMessageRow { role: string; tool_name: string | null; finish_reason: string | null; timestamp: number }
interface EventRow { id: number; session_id: string; role: string; finish_reason: string | null; timestamp: number; title: string | null }

export function stateDbPath(home: string, profile: HermesProfile): string {
  return path.join(profile.isDefault ? home : path.join(home, 'profiles', profile.id), 'state.db');
}

/** What the latest message says about the turn. */
export function turnState(last: LastMessageRow | undefined, now: number): { working: boolean; step: string | null } {
  if (!last || now - last.timestamp > TURN_STALE_S) return { working: false, step: null };
  if (last.role === 'assistant' && last.finish_reason !== 'tool_calls') return { working: false, step: null };
  if (last.role === 'tool') return { working: true, step: last.tool_name ? `used ${last.tool_name}` : 'using a tool' };
  if (last.role === 'assistant') return { working: true, step: 'calling a tool' };
  return { working: true, step: 'thinking' }; // user message waiting for a reply
}

function hasTable(db: Database.Database, name: string): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

export function readProfileActivity(home: string, profile: HermesProfile, now: number): { activity: ProfileActivity; events: HermesEvent[] } {
  const empty: ProfileActivity = { profileId: profile.id, working: false, step: null, current: null, lastActiveAt: null, chats24h: 0, recent: [] };
  const file = stateDbPath(home, profile);
  if (!fs.existsSync(file)) return { activity: empty, events: [] };

  let db: Database.Database | null = null;
  try {
    db = new Database(file, { readonly: true, fileMustExist: true });
    if (!hasTable(db, 'sessions') || !hasTable(db, 'messages')) return { activity: empty, events: [] };

    const sessions = db.prepare(`
      SELECT id, source, title, started_at, COALESCE(last_activity_at, started_at) AS last_at, message_count, ended_at
      FROM sessions
      WHERE COALESCE(hidden, 0) = 0 AND COALESCE(last_activity_at, started_at) >= ?
      ORDER BY last_at DESC LIMIT 20`).all(now - ACTIVITY_WINDOW_S) as SessionRow[];

    const lastMessage = db.prepare(`
      SELECT role, tool_name, finish_reason, timestamp FROM messages
      WHERE session_id = ? AND active = 1 ORDER BY id DESC LIMIT 1`);

    const recent: ChatSession[] = sessions.slice(0, 6).map(s => {
      const last = lastMessage.get(s.id) as LastMessageRow | undefined;
      const t = turnState(last, now);
      return {
        id: s.id, source: s.source, title: s.title?.slice(0, 120) || 'Untitled chat',
        lastAt: Math.max(s.last_at, last?.timestamp ?? 0), messages: s.message_count, working: t.working, step: t.step,
      };
    });
    const current = recent.find(r => r.working) ?? null;

    const rows = db.prepare(`
      SELECT m.id, m.session_id, m.role, m.finish_reason, m.timestamp, s.title
      FROM messages m JOIN sessions s ON s.id = m.session_id
      WHERE m.timestamp >= ? AND m.active = 1
        AND (m.role = 'user' OR (m.role = 'assistant' AND COALESCE(m.finish_reason, '') != 'tool_calls'))
      ORDER BY m.id DESC LIMIT 20`).all(now - CHAT_EVENT_WINDOW_S) as EventRow[];

    const events: HermesEvent[] = rows.map(r => ({
      // Negative, profile-scoped ids keep chat events apart from kanban event ids.
      id: -Math.round(r.timestamp * 1000 + (r.id % 1000)),
      taskId: r.session_id,
      taskTitle: r.title?.slice(0, 120) || 'Chat',
      kind: r.role === 'user' ? 'chat_message' : 'chat_reply',
      createdAt: Math.floor(r.timestamp),
      from: r.role === 'user' ? HUMAN_ID : profile.id,
      to: r.role === 'user' ? profile.id : HUMAN_ID,
      at: null,
      summary: null,
    }));

    return {
      activity: {
        profileId: profile.id,
        working: !!current,
        step: current?.step ?? null,
        current,
        lastActiveAt: recent[0]?.lastAt ?? null,
        chats24h: sessions.length,
        recent,
      },
      events,
    };
  } catch {
    return { activity: empty, events: [] };
  } finally {
    db?.close();
  }
}

export function readActivity(home: string, profiles: HermesProfile[], now: number): { activity: ProfileActivity[]; events: HermesEvent[] } {
  const activity: ProfileActivity[] = [];
  const events: HermesEvent[] = [];
  for (const p of profiles) {
    const r = readProfileActivity(home, p, now);
    activity.push(r.activity);
    events.push(...r.events);
  }
  return { activity, events };
}
