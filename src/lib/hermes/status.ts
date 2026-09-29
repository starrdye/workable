/**
 * hermes/status.ts — one status per agent, shared by the map and the roster.
 * Pure: returns a tone, an icon and an i18n key with parameters.
 */

import type { HermesProfile, HermesSnapshot } from './types';
import { formatDuration } from './metrics';

export type StatusTone = 'working' | 'bad' | 'warn' | 'ok' | 'idle';

export interface AgentStatus {
  tone: StatusTone;
  icon: string;
  /** i18n key; `{t}` is replaced with `ago`, `{n}` with `count`, `{step}` with `step`. */
  key: string;
  ago?: string;
  count?: number;
  step?: string | null;
  /** Current chat / card title, for the roster's second line. */
  detail?: string | null;
  working: boolean;
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

const RECENT_S = 3600;

export function agentStatus(snapshot: HermesSnapshot, profileId: string): AgentStatus {
  const act = snapshot.activity?.find(a => a.profileId === profileId);
  const tasks = snapshot.tasks.filter(t => t.assignee === profileId);
  const running = tasks.filter(t => t.dot === 'in-progress');
  const blocked = tasks.filter(t => t.dot === 'blocked');
  const review = tasks.filter(t => t.dot === 'review');
  const turn = act?.lastTurn ?? null;
  const turnAgo = turn?.outcomeAt ? snapshot.generatedAt - turn.outcomeAt : null;
  const recent = turnAgo != null && turnAgo < RECENT_S;
  const ago = turnAgo != null ? formatDuration(turnAgo) : undefined;

  if (act?.working) return { tone: 'working', icon: '●', key: 'hermes.st.replying', step: act.step, detail: act.current?.title ?? null, working: true };
  if (running.length) return { tone: 'working', icon: '●', key: 'hermes.st.runningCards', count: running.length, detail: running[0].title, working: true };
  if (blocked.length) return { tone: 'bad', icon: '■', key: 'hermes.st.blocked', count: blocked.length, detail: blocked[0].title, working: false };
  if (recent && turn?.outcome === 'failed') return { tone: 'bad', icon: '✕', key: 'hermes.st.failed', ago, detail: turn.title, working: false };
  if (recent && turn?.outcome === 'cut-off') return { tone: 'warn', icon: '!', key: 'hermes.st.cutoff', ago, detail: turn.title, working: false };
  if (recent && turn?.outcome === 'interrupted') return { tone: 'warn', icon: '!', key: 'hermes.st.noReply', ago, detail: turn.title, working: false };
  if (review.length) return { tone: 'warn', icon: '◐', key: 'hermes.st.review', count: review.length, detail: review[0].title, working: false };
  if (recent && turn?.outcome === 'completed') return { tone: 'ok', icon: '✓', key: 'hermes.st.replied', ago, detail: turn.title, working: false };
  if (tasks.length) return { tone: 'idle', icon: '○', key: 'hermes.st.queued', count: tasks.length, detail: tasks[0].title, working: false };
  return { tone: 'idle', icon: '○', key: 'hermes.st.idle', detail: turn?.title ?? null, working: false };
}

/** Fill a status's i18n string. */
export function statusText(s: AgentStatus, template: string): string {
  return template.replace('{t}', s.ago ?? '').replace('{n}', String(s.count ?? '')).replace('{step}', s.step ?? '').replace(/\s·\s$/, '');
}

/** CSS colour tokens per tone (text, soft background). */
export const TONE_VARS: Record<StatusTone, { fg: string; bg: string }> = {
  working: { fg: 'var(--h-accent)', bg: 'var(--h-accent-soft)' },
  bad: { fg: 'var(--h-bad)', bg: 'var(--h-bad-soft)' },
  warn: { fg: 'var(--h-warn)', bg: 'var(--h-warn-soft)' },
  ok: { fg: 'var(--h-ok)', bg: 'var(--h-ok-soft)' },
  idle: { fg: 'var(--h-muted)', bg: 'var(--h-sunk)' },
};
