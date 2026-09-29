/**
 * hermes/metrics.ts — Pure functions that turn board data into team edges,
 * per-profile metrics and a single bottleneck call-out. No I/O here, so the
 * same code runs on live data, sample data and in tests.
 */

import { humanError } from './errors';
import type {
  Bottleneck, DotStatus, HermesEdge, HermesEvent, HermesProfile, HermesRun, HermesTask, ProfileMetrics,
} from './types';

/** Event kinds that end a card's stay in review. */
export const REVIEW_EXIT_KINDS = ['completed', 'changes_requested', 'review_reopened', 'archived', 'assigned'];

/** Hermes has nine task statuses; Workable's task dots have five. */
export function toDotStatus(status: string): DotStatus {
  switch (status) {
    case 'running': return 'in-progress';
    case 'review':  return 'review';
    case 'blocked': return 'blocked';
    case 'done':
    case 'archived': return 'done';
    default: return 'todo'; // triage, todo, ready, scheduled
  }
}

/** Pseudo-node for the human operator (anything on the board that isn't a profile). */
export const HUMAN_ID = '__you';

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/** Map a board actor to a node id: a known profile, or the human pseudo-node. */
export function actorNode(actor: string | null, profileIds: Set<string>): string | null {
  if (!actor) return null;
  return profileIds.has(actor) ? actor : HUMAN_ID;
}

/**
 * Roster edges: the default profile is the orchestrator and delegates to every
 * other profile; the human talks to the orchestrator. Observed edges add any
 * creator → assignee flow seen on the board that the roster doesn't cover.
 */
export function buildEdges(profiles: HermesProfile[], tasks: HermesTask[]): HermesEdge[] {
  const ids = new Set(profiles.map(p => p.id));
  const hub = profiles.find(p => p.isDefault);
  const edges = new Map<string, HermesEdge>();
  const key = (a: string, b: string) => `${a}->${b}`;

  if (hub) {
    edges.set(key(HUMAN_ID, hub.id), { id: key(HUMAN_ID, hub.id), source: HUMAN_ID, target: hub.id, kind: 'roster', count: 0 });
    for (const p of profiles) {
      if (p.id === hub.id) continue;
      edges.set(key(hub.id, p.id), { id: key(hub.id, p.id), source: hub.id, target: p.id, kind: 'roster', count: 0 });
    }
  }

  for (const t of tasks) {
    const from = actorNode(t.createdBy, ids);
    const to = t.assignee && ids.has(t.assignee) ? t.assignee : null;
    if (!from || !to || from === to) continue;
    const k = key(from, to);
    const existing = edges.get(k);
    if (existing) existing.count += 1;
    else edges.set(k, { id: k, source: from, target: to, kind: 'observed', count: 1 });
  }
  return [...edges.values()];
}

const QUEUED = new Set(['triage', 'todo', 'ready', 'scheduled']);
const FOUR_HOURS = 4 * 3600;

export function computeMetrics(
  profiles: HermesProfile[],
  tasks: HermesTask[],
  reviewEvents: HermesEvent[],
  runs: HermesRun[],
  now: number,
): ProfileMetrics[] {
  // When did each card most recently enter review, and how long did past reviews take?
  const lastReviewStart = new Map<string, number>();
  const openReview = new Map<string, { at: number; reviewer: string | null }>();
  const reviewWaits = new Map<string, number[]>();
  for (const e of reviewEvents) {
    if (e.kind === 'review_requested') {
      openReview.set(e.taskId, { at: e.createdAt, reviewer: e.to ?? e.at });
      lastReviewStart.set(e.taskId, e.createdAt);
    } else if (REVIEW_EXIT_KINDS.includes(e.kind)) {
      const open = openReview.get(e.taskId);
      if (open) {
        const reviewer = open.reviewer ?? '';
        const list = reviewWaits.get(reviewer) ?? [];
        list.push(Math.max(0, e.createdAt - open.at));
        reviewWaits.set(reviewer, list);
        openReview.delete(e.taskId);
      }
    }
  }

  return profiles.map(p => {
    const mine = tasks.filter(t => t.assignee === p.id);
    const reviewCards = mine.filter(t => t.status === 'review');
    const waits = reviewCards.map(t => now - (lastReviewStart.get(t.id) ?? t.completedAt ?? t.startedAt ?? t.createdAt));
    const myRuns = runs.filter(r => r.profile === p.id && r.endedAt != null);
    const ok = myRuns.filter(r => r.outcome === 'completed' || r.outcome === 'review_requested');
    const failed = myRuns.filter(r => ['crashed', 'timed_out', 'spawn_failed', 'gave_up', 'failed'].includes(r.outcome ?? r.status));
    const lastFailure = [...failed].sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))[0];
    const blockedCard = mine.find(t => t.status === 'blocked' && t.lastFailureError);

    const m: ProfileMetrics = {
      profileId: p.id,
      queued: mine.filter(t => QUEUED.has(t.status)).length,
      running: mine.filter(t => t.status === 'running').length,
      blocked: mine.filter(t => t.status === 'blocked').length,
      reviewQueue: reviewCards.length,
      oldestReviewWait: waits.length ? Math.max(...waits) : null,
      medianReviewWait: median(reviewWaits.get(p.id) ?? []),
      runs: myRuns.length,
      successRate: myRuns.length ? ok.length / myRuns.length : null,
      medianRunSeconds: median(myRuns.map(r => (r.endedAt as number) - r.startedAt)),
      failures: failed.length,
      lastError: blockedCard?.lastFailureError ?? lastFailure?.error ?? null,
      load: 0,
    };
    m.load = loadScore(m);
    return m;
  });
}

/** 0–1 heat score. Weights favour things a human can act on: blocked cards and stale reviews. */
export function loadScore(m: ProfileMetrics): number {
  let score = 0;
  score += Math.min(m.queued, 5) * 0.06;
  score += Math.min(m.reviewQueue, 5) * 0.08;
  score += Math.min(m.blocked, 2) * 0.3; // one blocked card always needs a human
  if (m.oldestReviewWait != null) score += Math.min(m.oldestReviewWait / FOUR_HOURS, 1) * 0.3;
  if (m.successRate != null && m.runs >= 3) score += (1 - m.successRate) * 0.3;
  return Math.min(1, Math.round(score * 100) / 100);
}

export function formatDuration(seconds: number | null): string {
  if (seconds == null) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600), mins = Math.round((seconds % 3600) / 60);
  return mins ? `${h}h ${mins}m` : `${h}h`;
}

/** Threshold below which nothing is called out. */
export const BOTTLENECK_THRESHOLD = 0.3;

export function detectBottleneck(metrics: ProfileMetrics[], profiles: HermesProfile[]): Bottleneck | null {
  const top = [...metrics].sort((a, b) => b.load - a.load)[0];
  if (!top || top.load < BOTTLENECK_THRESHOLD) return null;
  const name = profiles.find(p => p.id === top.profileId)?.name ?? top.profileId;

  if (top.blocked > 0) {
    return {
      profileId: top.profileId,
      reason: `${name} has ${top.blocked} blocked card${top.blocked > 1 ? 's' : ''}${top.lastError ? `: ${humanError(top.lastError)?.slice(0, 120)}` : ''}.`,
      suggestion: 'Check the error, then fix the cause (add backoff, split the card, or change the model) and unblock it.',
    };
  }
  if (top.reviewQueue > 0) {
    return {
      profileId: top.profileId,
      reason: `${top.reviewQueue} card${top.reviewQueue > 1 ? 's are' : ' is'} waiting for ${name} to review; the oldest has waited ${formatDuration(top.oldestReviewWait)}.`,
      suggestion: 'Spot-check low-risk work instead of reviewing every card, or give routine cards a second reviewer.',
    };
  }
  if (top.successRate != null && top.runs >= 3 && top.successRate < 0.7) {
    return {
      profileId: top.profileId,
      reason: `Only ${Math.round(top.successRate * 100)}% of ${name}'s last ${top.runs} runs finished cleanly.`,
      suggestion: 'Open the failed cards in Replay to see where they stop. The card specs or the model may not fit this role.',
    };
  }
  return {
    profileId: top.profileId,
    reason: `${top.queued} card${top.queued > 1 ? 's are' : ' is'} queued for ${name}${top.running ? '' : ' and nothing is running'}.`,
    suggestion: 'Move some cards to an idle profile, or add a second worker with the same role.',
  };
}

/**
 * Seconds a card spent with each holder, from its ordered events. After a
 * hand-off the receiver holds it; after an on-node event, that node does.
 */
export function timeByHolder(events: HermesEvent[]): Array<{ holder: string; seconds: number }> {
  const totals = new Map<string, number>();
  let holder: string | null = null;
  for (let i = 0; i < events.length; i++) {
    const h = events[i].to ?? events[i].at ?? null;
    if (h) holder = h;
    const next = events[i + 1];
    if (holder && next) totals.set(holder, (totals.get(holder) ?? 0) + Math.max(0, next.createdAt - events[i].createdAt));
  }
  return [...totals.entries()].map(([h, seconds]) => ({ holder: h, seconds })).sort((a, b) => b.seconds - a.seconds);
}
