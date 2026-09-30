/**
 * hermes/status.ts — one status per agent and one row per request, shared by
 * the map, the roster and the requests table. Pure.
 *
 * Status labels follow the monday.com board idea: a solid colour block with
 * one short word, so "has it replied yet?" is readable at a glance.
 *   Waiting (blue) · Working (orange) · Done (green) · Failed (red) · Review (purple) · Idle (grey)
 */

import type { HermesProfile, HermesSnapshot, HermesTask, TurnOutcome } from './types';
import { HUMAN_ID, formatDuration } from './metrics';
import { humanError } from './errors';

export { humanError };

export type StatusTone = 'waiting' | 'working' | 'ok' | 'bad' | 'warn' | 'idle';

export interface AgentStatus {
  tone: StatusTone;
  /** i18n key of the one-word label; `{n}` is replaced with `count`. */
  key: string;
  count?: number;
  /** Secondary text: what it's doing now ("thinking") or how long ago ("2m"). */
  step?: string | null;
  ago?: string;
  /** Unix seconds this status started (a card's start, a reply's finish), when known. */
  at?: number;
  /** Current chat / card title, for the roster's second line. */
  detail?: string | null;
  working: boolean;
  /** Cards assigned to it that are still blocked, even when a newer request went fine. */
  blockedCards: number;
}

/** "Clerk: mechanical data work…" → "Clerk"; drops a leading "TEST ·". */
export function roleOf(profile: HermesProfile): string {
  const desc = profile.description.replace(/^TEST\s*[·:-]?\s*/i, '').trim();
  const head = desc.split(':')[0].trim();
  if (head && head.length <= 24 && head !== desc) return head.charAt(0).toUpperCase() + head.slice(1);
  if (profile.isDefault) return 'Orchestrator';
  return desc.split(/\s+/).slice(0, 3).join(' ') || 'Worker';
}

/** Display name without the shared "personal-" prefix. */
export function shortName(profile: HermesProfile): string {
  return (profile.isDefault ? profile.name : profile.id).replace(/^personal-/, '');
}

/** Finished work older than this no longer sets the status. */
const RECENT_S = 24 * 3600;
/** Cards an agent handed out that are still coming back (blocked ones have failed; they aren't pending). */
const PENDING: HermesTask['status'][] = ['triage', 'todo', 'ready', 'scheduled', 'running', 'review'];

/** A blocked card that got there by failing runs is "Failed"; one blocked by hand is "Blocked". */
function blockedByFailure(t: HermesTask): boolean {
  return t.consecutiveFailures > 0 || !!t.lastFailureError;
}

function cardTime(t: HermesTask): number {
  return t.completedAt ?? t.startedAt ?? t.createdAt;
}

/**
 * One status per agent, in priority order:
 * working → own queued cards → latest request failed/blocked → waiting on cards it handed out
 * → latest request in review → latest request replied → idle.
 * "Latest request" is the newer of its latest card and its latest chat with you, so an
 * old failure stops showing once a newer request succeeds.
 */
export function agentStatus(snapshot: HermesSnapshot, profileId: string): AgentStatus {
  const blockedCards = snapshot.tasks.filter(t => t.assignee === profileId && t.status === 'blocked').length;
  return { ...baseStatus(snapshot, profileId), blockedCards };
}

function baseStatus(snapshot: HermesSnapshot, profileId: string): Omit<AgentStatus, 'blockedCards'> {
  const act = snapshot.activity?.find(a => a.profileId === profileId);
  const tasks = snapshot.tasks.filter(t => t.assignee === profileId);
  const running = tasks.filter(t => t.status === 'running');
  const queued = tasks.filter(t => t.dot === 'todo');
  const pending = snapshot.tasks.filter(t => t.createdBy === profileId && t.assignee && t.assignee !== profileId && PENDING.includes(t.status));
  const now = snapshot.generatedAt;
  const ago = (at: number) => formatDuration(Math.max(0, now - at));

  if (act?.working) return { tone: 'working', key: 'hermes.st.working', step: act.step, detail: act.current?.title ?? null, working: true };
  if (running.length) return { tone: 'working', key: 'hermes.st.working', step: null, detail: running[0].title, at: running[0].startedAt ?? undefined, working: true };
  if (queued.length) return { tone: 'waiting', key: 'hermes.st.waiting', detail: queued[0].title, at: queued[0].createdAt, working: false };

  // Latest request: newest card (by when it last changed) vs newest chat with you (worker runs excluded).
  const card = [...tasks].sort((x, y) => cardTime(y) - cardTime(x))[0] ?? null;
  const chat = act?.recent.find(c => c.source !== 'kanban' && c.outcome !== 'none' && c.outcome !== 'working') ?? null;
  const cardAt = card ? cardTime(card) : -1;
  const chatAt = chat ? chat.outcomeAt ?? chat.lastAt : -1;
  const useCard = !!card && cardAt >= chatAt;
  const at = useCard ? cardAt : chatAt;
  const recent = at >= 0 && now - at < RECENT_S;

  if (recent && useCard && card!.status === 'blocked') {
    const failed = blockedByFailure(card!);
    return { tone: 'bad', key: failed ? 'hermes.st.failed' : 'hermes.st.blocked', ago: ago(at), at, detail: humanError(card!.lastFailureError) ?? card!.title, working: false };
  }
  if (recent && !useCard && chat && chat.outcome !== 'completed') {
    return { tone: 'bad', key: chat.outcome === 'failed' ? 'hermes.st.failed' : 'hermes.st.noReply', ago: ago(at), at, detail: humanError(chat.error) ?? chat.title, working: false };
  }
  if (pending.length) return { tone: 'waiting', key: 'hermes.st.waitingOn', count: pending.length, detail: pending[0].title, at: Math.min(...pending.map(t => t.createdAt)), working: false };
  if (recent && useCard && card!.status === 'review') return { tone: 'warn', key: 'hermes.st.review', ago: ago(at), at, detail: card!.title, working: false };
  if (recent) return { tone: 'ok', key: 'hermes.st.done', ago: ago(at), at, detail: useCard ? card!.title : chat!.title, working: false };
  return { tone: 'idle', key: 'hermes.st.idle', detail: null, working: false };
}

/** Fill a status's one-word label. */
export function statusText(s: AgentStatus, template: string): string {
  return template.replace('{n}', String(s.count ?? ''));
}

/**
 * Colour per tone. `bg`/`fg` are for blocks that carry text (deeper shades, ≥ 4.5:1 with
 * white); `bar` is the bright status colour for bars, dots and connectors; `soft` a tint.
 */
export const TONE_VARS: Record<StatusTone, { fg: string; bg: string; bar: string; soft: string }> = {
  waiting: { fg: '#FFFFFF', bg: 'var(--h-st-waiting-solid)', bar: 'var(--h-st-waiting)', soft: 'var(--h-st-waiting-soft)' },
  working: { fg: '#FFFFFF', bg: 'var(--h-st-working-solid)', bar: 'var(--h-st-working)', soft: 'var(--h-st-working-soft)' },
  ok: { fg: '#FFFFFF', bg: 'var(--h-st-done-solid)', bar: 'var(--h-st-done)', soft: 'var(--h-st-done-soft)' },
  bad: { fg: '#FFFFFF', bg: 'var(--h-st-stuck-solid)', bar: 'var(--h-st-stuck)', soft: 'var(--h-st-stuck-soft)' },
  warn: { fg: '#FFFFFF', bg: 'var(--h-st-review-solid)', bar: 'var(--h-st-review)', soft: 'var(--h-st-review-soft)' },
  idle: { fg: 'var(--h-text-2)', bg: 'var(--h-st-idle)', bar: 'var(--h-st-idle)', soft: 'var(--h-sunk)' },
};

/* ------------------------------------------------------------------ */
/* Requests: who asked whom, and whether they replied                  */
/* ------------------------------------------------------------------ */

export type RequestState = 'waiting' | 'working' | 'done' | 'failed' | 'blocked' | 'review';

export interface RequestRow {
  id: string;
  kind: 'card' | 'chat';
  /** Profile id, or HUMAN_ID for you. */
  from: string;
  to: string;
  title: string;
  state: RequestState;
  /** Unix seconds of the latest change. */
  at: number;
  /** What it's doing now, or the error / reply summary. */
  note: string | null;
}

export const REQUEST_TONE: Record<RequestState, StatusTone> = {
  waiting: 'waiting', working: 'working', done: 'ok', failed: 'bad', blocked: 'bad', review: 'warn',
};

export function cardState(t: HermesTask): RequestState {
  switch (t.status) {
    case 'running': return 'working';
    case 'done': case 'archived': return 'done';
    case 'blocked': return blockedByFailure(t) ? 'failed' : 'blocked';
    case 'review': return 'review';
    default: return 'waiting';
  }
}

function chatState(o: TurnOutcome): RequestState {
  if (o === 'working') return 'working';
  if (o === 'completed') return 'done';
  if (o === 'none') return 'waiting';
  return 'failed';
}

/**
 * Recent requests, newest first: kanban cards (creator → assignee) and your
 * chats with each agent (you → agent). Open requests always stay in the list.
 * A worker's kanban run is its own session too; the card row stands for it.
 */
export function requestRows(snapshot: HermesSnapshot, windowS = 24 * 3600, limit = 20): RequestRow[] {
  const known = new Set(snapshot.profiles.map(p => p.id));
  const who = (id: string | null) => (id && known.has(id) ? id : HUMAN_ID);
  const rows: RequestRow[] = [];

  for (const t of snapshot.tasks) {
    if (!t.assignee) continue;
    const state = cardState(t);
    const at = cardTime(t);
    if (state === 'done' && snapshot.generatedAt - at > windowS) continue;
    rows.push({
      id: t.id, kind: 'card', from: who(t.createdBy), to: who(t.assignee), title: t.title, state, at,
      note: state === 'failed' || state === 'blocked' ? humanError(t.lastFailureError)
        : state === 'done' ? (t.reply ? `“${t.reply.split('\n')[0]}”` : 'Finished without a reply') : null,
    });
  }
  for (const a of snapshot.activity ?? []) {
    for (const c of a.recent) {
      if (c.source === 'kanban') continue; // the card row already covers a worker's run
      if (c.outcome === 'none') continue; // opened but never asked anything
      if (snapshot.generatedAt - c.lastAt > windowS && !c.working) continue;
      rows.push({
        id: `${a.profileId}:${c.id}`, kind: 'chat', from: HUMAN_ID, to: a.profileId, title: c.title,
        state: chatState(c.outcome), at: c.outcomeAt ?? c.lastAt, note: c.working ? c.step : humanError(c.error),
      });
    }
  }
  return rows.sort((x, y) => y.at - x.at).slice(0, limit);
}

/** Counts per state, for the "3 done · 1 failed" summary. */
export function requestSummary(rows: RequestRow[]): Record<RequestState, number> {
  const out: Record<RequestState, number> = { waiting: 0, working: 0, done: 0, failed: 0, blocked: 0, review: 0 };
  for (const r of rows) out[r.state]++;
  return out;
}

/* ------------------------------------------------------------------ */
/* Team summary: the small indicator in the Hermes status bar / card   */
/* ------------------------------------------------------------------ */

export interface TeamSummaryAgent {
  id: string;
  name: string;
  tone: StatusTone;
  /** One word: "Working", "Replied", "Failed"… */
  label: string;
  /** Quiet text: what it's doing now, or how long ago. */
  sub: string;
  detail: string | null;
  /** Unix seconds this status started, so the card can tick "1m 12s" / "2m ago" live. */
  at: number | null;
  /** What it's doing right now ("thinking", "used terminal"), while working. */
  step: string | null;
  /** Open problem that the status word doesn't show, e.g. "2 blocked". */
  alert: string | null;
}

/** The orchestrator's latest batch of cards (sent within two minutes of each other). */
export interface TeamRound {
  by: string;
  startedAt: number;
  total: number;
  done: number;
  failed: number;
  working: number;
  waiting: number;
}

export interface TeamSummary {
  generatedAt: number;
  install: string;
  board: string | null;
  /** Agents per status, plus `blocked`: cards still blocked across the team. */
  counts: { working: number; waiting: number; failed: number; replied: number; blocked: number };
  /** The one line the status bar shows, e.g. "2 working", with its colour. */
  headline: { tone: StatusTone; text: string };
  agents: TeamSummaryAgent[];
  /** Latest round of hand-offs, if one started in the last 24 h. */
  round: TeamRound | null;
  /** The most recent thing that happened, in one line. */
  latest: { tone: StatusTone; text: string; at: number } | null;
}

const ROUND_GAP_S = 120;

/** The newest group of cards one creator handed out together. */
export function latestRound(snapshot: HermesSnapshot): TeamRound | null {
  const known = new Set(snapshot.profiles.map(p => p.id));
  const cards = snapshot.tasks.filter(t => t.createdBy && known.has(t.createdBy) && t.assignee && t.assignee !== t.createdBy);
  const newest = cards.reduce<HermesTask | null>((a, t) => (!a || t.createdAt > a.createdAt ? t : a), null);
  if (!newest || snapshot.generatedAt - newest.createdAt > 24 * 3600) return null;
  const batch = cards.filter(t => t.createdBy === newest.createdBy && newest.createdAt - t.createdAt <= ROUND_GAP_S);
  const n = (f: (s: RequestState) => boolean) => batch.filter(t => f(cardState(t))).length;
  return {
    by: newest.createdBy!, startedAt: Math.min(...batch.map(t => t.createdAt)), total: batch.length,
    done: n(s => s === 'done'), failed: n(s => s === 'failed' || s === 'blocked'),
    working: n(s => s === 'working' || s === 'review'), waiting: n(s => s === 'waiting'),
  };
}

/** One line for the newest request: "clerk replied “1”", "editor failed: Timed out…". */
function latestLine(snapshot: HermesSnapshot): TeamSummary['latest'] {
  const row = requestRows(snapshot, 24 * 3600, 1)[0];
  if (!row) return null;
  const name = (id: string) => {
    const p = snapshot.profiles.find(x => x.id === id);
    return p ? shortName(p) : 'you';
  };
  const to = name(row.to), from = name(row.from);
  const text =
    row.state === 'done' ? `${to} replied to ${from}${row.note && row.note.startsWith('“') ? ` ${row.note}` : ''}`
    : row.state === 'failed' || row.state === 'blocked' ? `${to} failed${row.note ? `: ${row.note}` : ''}`
    : row.state === 'working' ? `${to} is working on “${row.title}”`
    : row.state === 'review' ? `${to} sent “${row.title}” for review`
    : `${from} asked ${to}: “${row.title}”`;
  return { tone: REQUEST_TONE[row.state], text, at: row.at };
}

/**
 * Everything the Hermes status-bar chip and floating card need, already worded,
 * so the plugin stays a thin renderer. `label` fills an i18n key (English).
 */
export function teamSummary(snapshot: HermesSnapshot, label: (key: string) => string): TeamSummary {
  const ordered = [...snapshot.profiles].sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
  const agents = ordered.map(p => {
    const st = agentStatus(snapshot, p.id);
    const sub = st.working ? st.step ?? '' : st.ago ? label('hermes.req.ago').replace('{t}', st.ago) : '';
    return {
      id: p.id, name: shortName(p), tone: st.tone, label: statusText(st, label(st.key)), sub,
      detail: st.detail ?? null, at: st.at ?? null, step: st.working ? st.step ?? null : null,
      alert: st.tone !== 'bad' && st.blockedCards ? `${st.blockedCards} blocked` : null,
    };
  });
  const count = (tone: StatusTone) => agents.filter(a => a.tone === tone).length;
  const blocked = snapshot.tasks.filter(t => t.status === 'blocked' && ordered.some(p => p.id === t.assignee)).length;
  const counts = { working: count('working'), waiting: count('waiting'), failed: count('bad'), replied: count('ok'), blocked };
  // Never "All replied" while something is still broken.
  const headline: TeamSummary['headline'] =
    counts.working ? { tone: 'working', text: `${counts.working} working` }
    : counts.waiting ? { tone: 'waiting', text: `${counts.waiting} waiting` }
    : counts.failed ? { tone: 'bad', text: `${counts.failed} failed` }
    : blocked ? { tone: 'bad', text: `${blocked} blocked` }
    : counts.replied ? { tone: 'ok', text: 'All replied' }
    : { tone: 'idle', text: 'Team idle' };
  const install = snapshot.homes.find(h => h.id === snapshot.homeId)?.label ?? snapshot.homeId;
  return {
    generatedAt: snapshot.generatedAt, install, board: snapshot.board?.slug ?? null, counts, headline, agents,
    round: latestRound(snapshot), latest: latestLine(snapshot),
  };
}
