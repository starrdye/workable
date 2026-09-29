// src/__tests__/hermes-sessions.test.ts
// Live chat activity from a fake profile session store (state.db).

import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readActivity, turnOutcome, turnState, TURN_STALE_S } from '@/lib/hermes/sessions';
import { HUMAN_ID } from '@/lib/hermes/metrics';
import type { HermesProfile } from '@/lib/hermes/types';

const NOW = 1_790_650_000;
let home: string;

// Clerk rows need the 7th column (display_kind); others are padded with null.
const profile = (id: string, isDefault = false): HermesProfile =>
  ({ id, name: id, description: '', model: null, isDefault, unattended: !isDefault, disabledToolsets: [] });

function makeDb(file: string, rows: { sessions: unknown[][]; messages: unknown[][] }) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.exec(`
    CREATE TABLE sessions (id TEXT PRIMARY KEY, source TEXT NOT NULL, title TEXT, started_at REAL NOT NULL,
      last_activity_at REAL, message_count INTEGER DEFAULT 0, ended_at REAL, hidden INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, role TEXT NOT NULL,
      content TEXT, tool_name TEXT, finish_reason TEXT, timestamp REAL NOT NULL, active INTEGER NOT NULL DEFAULT 1,
      display_kind TEXT);`);
  const s = db.prepare('INSERT INTO sessions (id, source, title, started_at, last_activity_at, message_count, ended_at, hidden) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  rows.sessions.forEach(r => s.run(...r));
  const m = db.prepare('INSERT INTO messages (session_id, role, content, tool_name, finish_reason, timestamp, display_kind) VALUES (?, ?, ?, ?, ?, ?, ?)');
  rows.messages.forEach(r => m.run(...[...r, ...Array(7 - r.length).fill(null)]));
  db.close();
}

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-sessions-'));
  // Orchestrator: finished a chat 20 minutes ago.
  makeDb(path.join(home, 'state.db'), {
    sessions: [['s_done', 'cli', 'Weekly plan', NOW - 1500, NOW - 1200, 4, null, 0]],
    messages: [['s_done', 'user', 'secret text', null, null, NOW - 1300], ['s_done', 'assistant', 'reply', null, 'stop', NOW - 1200]],
  });
  // Assistant: mid-turn, just ran a tool. Plus a hidden session that must not show.
  makeDb(path.join(home, 'profiles/assistant/state.db'), {
    sessions: [
      ['s_live', 'desktop', 'Draft captions', NOW - 60, NOW - 5, 3, null, 0],
      ['s_hidden', 'desktop', 'Hidden', NOW - 60, NOW - 50, 1, null, 1],
    ],
    messages: [
      ['s_live', 'user', 'please draft', null, null, NOW - 30],
      ['s_live', 'assistant', '', null, 'tool_calls', NOW - 20],
      ['s_live', 'tool', 'output', 'terminal', null, NOW - 5],
    ],
  });
  // Clerk: its last turn failed, in a hidden desktop session (how the desktop app stores chats).
  makeDb(path.join(home, 'profiles/clerk/state.db'), {
    sessions: [['s_fail', 'desktop', 'Bot Chat', NOW - 300, NOW - 200, 2, null, 1]],
    messages: [
      ['s_fail', 'user', 'hello', null, null, NOW - 260],
      ['s_fail', 'assistant', 'Your request was not processed.\nSend it again.', null, null, NOW - 200, 'failed_turn'],
    ],
  });
});

afterAll(() => fs.rmSync(home, { recursive: true, force: true }));

describe('turnState', () => {
  const msg = (role: string, extra: Partial<{ tool_name: string; finish_reason: string }> = {}, ago = 5) =>
    ({ role, tool_name: extra.tool_name ?? null, finish_reason: extra.finish_reason ?? null, timestamp: NOW - ago });

  it('reads the turn from the latest message', () => {
    expect(turnState(msg('user'), NOW)).toEqual({ working: true, step: 'thinking' });
    expect(turnState(msg('assistant', { finish_reason: 'tool_calls' }), NOW)).toEqual({ working: true, step: 'calling a tool' });
    expect(turnState(msg('tool', { tool_name: 'terminal' }), NOW)).toEqual({ working: true, step: 'used terminal' });
    expect(turnState(msg('assistant', { finish_reason: 'stop' }), NOW)).toEqual({ working: false, step: null });
  });

  it('reports how a finished turn ended', () => {
    expect(turnOutcome({ ...msg('assistant', { finish_reason: 'stop' }) }, NOW).outcome).toBe('completed');
    expect(turnOutcome({ ...msg('assistant'), display_kind: 'failed_turn', error_line: 'Not processed' }, NOW)).toMatchObject({ outcome: 'failed', error: 'Not processed' });
    expect(turnOutcome({ ...msg('assistant', { finish_reason: 'error' }) }, NOW).outcome).toBe('failed');
    expect(turnOutcome({ ...msg('assistant', { finish_reason: 'length' }) }, NOW).outcome).toBe('cut-off');
    expect(turnOutcome(msg('user', {}, TURN_STALE_S + 1), NOW).outcome).toBe('interrupted');
  });

  it('treats an abandoned turn as idle', () => {
    expect(turnState(msg('user', {}, TURN_STALE_S + 1), NOW).working).toBe(false);
    expect(turnState(undefined, NOW).working).toBe(false);
  });
});

describe('readActivity', () => {
  const profiles = [profile('default', true), profile('assistant'), profile('clerk')];


  it('shows who is replying right now and what they are doing', () => {
    const { activity } = readActivity(home, profiles, NOW);
    const a = activity.find(x => x.profileId === 'assistant')!;
    expect(a).toMatchObject({ working: true, step: 'used terminal', chats24h: 2 });
    expect(a.current).toMatchObject({ id: 's_live', source: 'desktop', title: 'Draft captions' });
    expect(a.recent.map(r => r.id)).toEqual(['s_live', 's_hidden']); // the desktop app's hidden sessions count

    const lead = activity.find(x => x.profileId === 'default')!;
    expect(lead).toMatchObject({ working: false, chats24h: 1, lastActiveAt: NOW - 1200 });
    const clerk = activity.find(x => x.profileId === 'clerk')!;
    expect(clerk).toMatchObject({ working: false, chats24h: 1 });
    expect(clerk.lastTurn).toMatchObject({ outcome: 'failed', error: 'Your request was not processed.', source: 'desktop' });
  });

  it('turns your messages and finished replies into hand-offs, without message text', () => {
    const { events } = readActivity(home, profiles, NOW);
    const assistant = events.filter(e => e.taskId === 's_live');
    expect(assistant.map(e => e.kind)).toEqual(['chat_message']); // tool-call steps are not replies
    expect(assistant[0]).toMatchObject({ from: HUMAN_ID, to: 'assistant', taskTitle: 'Draft captions' });
    const lead = events.filter(e => e.taskId === 's_done').map(e => [e.kind, e.from, e.to]);
    expect(lead).toEqual([['chat_reply', 'default', HUMAN_ID], ['chat_message', HUMAN_ID, 'default']]);
    expect(JSON.stringify(events)).not.toContain('secret text');
    expect(events.filter(e => e.taskId === 's_fail').map(e => e.kind)).toEqual(['chat_failed', 'chat_message']);
  });

  it('never modifies the session store', () => {
    const file = path.join(home, 'profiles/assistant/state.db');
    const before = fs.readFileSync(file);
    readActivity(home, profiles, NOW);
    expect(fs.readFileSync(file).equals(before)).toBe(true);
  });
});
