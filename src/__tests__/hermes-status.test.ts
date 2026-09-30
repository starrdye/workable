// src/__tests__/hermes-status.test.ts
// One status per agent, and the "who asked whom / did they reply" rows.

import { describe, expect, it } from 'vitest';
import { agentStatus, humanError, latestRound, requestRows, requestSummary, teamSummary } from '@/lib/hermes/status';
import { HUMAN_ID, toDotStatus } from '@/lib/hermes/metrics';
import type { ChatSession, HermesProfile, HermesSnapshot, HermesTask, HermesTaskStatus } from '@/lib/hermes/types';

const NOW = 1_790_690_000;

const profile = (id: string, isDefault = false): HermesProfile =>
  ({ id, name: id, description: '', model: null, isDefault, unattended: !isDefault, disabledToolsets: [] });

const task = (id: string, assignee: string, status: HermesTaskStatus, extra: Partial<HermesTask> = {}): HermesTask => ({
  id, title: `Ping ${assignee}`, assignee, createdBy: 'default', status, dot: toDotStatus(status), priority: 0,
  createdAt: NOW - 300, startedAt: status === 'ready' ? null : NOW - 200, completedAt: status === 'done' ? NOW - 60 : null,
  consecutiveFailures: 0, lastFailureError: null, tenant: null, projectId: null, ...extra,
});

const chat = (id: string, outcome: ChatSession['outcome'], extra: Partial<ChatSession> = {}): ChatSession => ({
  id, source: 'desktop', title: `Chat ${id}`, lastAt: NOW - 30, messages: 2, working: outcome === 'working',
  step: outcome === 'working' ? 'thinking' : null, outcome, outcomeAt: NOW - 30, error: null, ...extra,
});

function snap(tasks: HermesTask[], recent: Record<string, ChatSession[]> = {}): HermesSnapshot {
  const profiles = [profile('default', true), profile('researcher'), profile('clerk'), profile('editor')];
  return {
    generatedAt: NOW, profiles, tasks,
    activity: profiles.map(p => {
      const r = recent[p.id] ?? [];
      return { profileId: p.id, working: r.some(c => c.working), step: r.find(c => c.working)?.step ?? null,
        current: r.find(c => c.working) ?? null, lastTurn: r[0] ?? null, lastActiveAt: r[0]?.lastAt ?? null, chats24h: r.length, recent: r };
    }),
  } as unknown as HermesSnapshot;
}

describe('agentStatus', () => {
  it('reads each worker from its card: waiting, working, replied, failed', () => {
    const s = snap([
      task('t1', 'researcher', 'ready'),
      task('t2', 'clerk', 'running'),
      task('t3', 'editor', 'blocked', { lastFailureError: 'worker crashed\ntrace' }),
    ]);
    expect(agentStatus(s, 'researcher')).toMatchObject({ tone: 'waiting', key: 'hermes.st.waiting' });
    expect(agentStatus(s, 'clerk')).toMatchObject({ tone: 'working', working: true });
    expect(agentStatus(s, 'editor')).toMatchObject({ tone: 'bad', key: 'hermes.st.failed', detail: 'Worker crashed before replying' });
  });

  it('shows the orchestrator waiting on the cards it handed out', () => {
    const s = snap([task('t1', 'researcher', 'ready'), task('t2', 'clerk', 'done'), task('t3', 'editor', 'running')]);
    expect(agentStatus(s, 'default')).toMatchObject({ tone: 'waiting', key: 'hermes.st.waitingOn', count: 2 });
  });

  it('marks a finished chat as replied, a failed one as failed', () => {
    const s = snap([], { researcher: [chat('a', 'completed')], clerk: [chat('b', 'failed', { error: 'bad model' })] });
    expect(agentStatus(s, 'researcher')).toMatchObject({ tone: 'ok', key: 'hermes.st.done' });
    expect(agentStatus(s, 'clerk')).toMatchObject({ tone: 'bad', key: 'hermes.st.failed', detail: 'bad model' });
  });
});

describe('agentStatus — the test rounds from the Hermes session', () => {
  // Round 2: three cards done, the editor's timed out twice (blocked). Round 3 ("make them all fail"):
  // four cards, all timed out twice. The orchestrator's own chat finished after round 3.
  const r2 = (w: string, status: HermesTaskStatus) => task(`r2-${w}`, w, status, {
    createdAt: NOW - 3000, startedAt: NOW - 2900, completedAt: status === 'done' ? NOW - 2000 : null,
    consecutiveFailures: status === 'blocked' ? 2 : 0, lastFailureError: status === 'blocked' ? 'elapsed 60s > limit 60s' : null,
  });
  const r3 = (w: string) => task(`r3-${w}`, w, 'blocked', {
    createdAt: NOW - 1000, startedAt: NOW - 950, consecutiveFailures: 2, lastFailureError: 'elapsed 50s > limit 45s',
  });
  const orchestratorChat = { default: [chat('o', 'completed', { outcomeAt: NOW - 800, lastAt: NOW - 800 })] };

  it('does not say the orchestrator is waiting on cards that already failed', () => {
    const s = snap([r2('researcher', 'done'), r2('clerk', 'done'), r2('editor', 'blocked'), r3('researcher'), r3('clerk'), r3('editor')], orchestratorChat);
    const lead = agentStatus(s, 'default');
    expect(lead.key).not.toBe('hermes.st.waitingOn');
    expect(lead).toMatchObject({ tone: 'ok', key: 'hermes.st.done' });
  });

  it('shows each worker as failed with a plain reason', () => {
    const s = snap([r2('researcher', 'done'), r3('researcher')], orchestratorChat);
    expect(agentStatus(s, 'researcher')).toMatchObject({ tone: 'bad', key: 'hermes.st.failed', detail: 'Timed out after 50s (limit 45s)' });
  });

  it('lets a newer reply replace an older failure', () => {
    const later = task('r4-researcher', 'researcher', 'done', { createdAt: NOW - 200, startedAt: NOW - 150, completedAt: NOW - 100 });
    expect(agentStatus(snap([r3('researcher'), later]), 'researcher')).toMatchObject({ tone: 'ok', key: 'hermes.st.done' });
  });

  it('still counts cards that are genuinely out', () => {
    const s = snap([r3('editor'), task('q1', 'researcher', 'ready'), task('q2', 'clerk', 'running')], orchestratorChat);
    expect(agentStatus(s, 'default')).toMatchObject({ tone: 'waiting', key: 'hermes.st.waitingOn', count: 2 });
  });

  it('calls a card blocked by hand "Blocked", not "Failed"', () => {
    expect(agentStatus(snap([task('b', 'clerk', 'blocked')]), 'clerk')).toMatchObject({ key: 'hermes.st.blocked' });
  });

  it('ignores a worker\'s own kanban run when picking its latest chat', () => {
    const s = snap([], { clerk: [chat('k', 'failed', { source: 'kanban', error: 'x' })] });
    expect(agentStatus(s, 'clerk').key).toBe('hermes.st.idle');
  });
});

describe('humanError', () => {
  it('turns Hermes run errors into plain words', () => {
    expect(humanError('elapsed 50s > limit 45s')).toBe('Timed out after 50s (limit 45s)');
    expect(humanError('pid 55238 not alive')).toBe('Worker crashed before replying');
    expect(humanError('Your request was not processed.\nSend it again.')).toBe('Your request was not processed.');
    expect(humanError(null)).toBeNull();
  });
});

describe('requestRows', () => {
  it('lists who asked whom and whether they replied, newest first', () => {
    const s = snap(
      [task('t1', 'researcher', 'done'), task('t2', 'clerk', 'ready'), task('t3', 'editor', 'blocked', { lastFailureError: 'crashed' })],
      { clerk: [chat('c1', 'working')] },
    );
    const rows = requestRows(s);
    expect(rows.map(r => [r.from, r.to, r.state])).toEqual([
      [HUMAN_ID, 'clerk', 'working'],
      ['default', 'researcher', 'done'],
      ['default', 'editor', 'failed'],
      ['default', 'clerk', 'waiting'],
    ]);
    expect(rows.find(r => r.to === 'editor')?.note).toBe('crashed');
    expect(requestSummary(rows)).toMatchObject({ done: 1, waiting: 1, working: 1, failed: 1 });
  });

  it('shows what each worker sent back, and flags a card finished with no reply', () => {
    const rows = requestRows(snap([
      task('a', 'researcher', 'done', { reply: '1' }),
      task('b', 'editor', 'done', { reply: null }),
    ]));
    expect(rows.find(r => r.id === 'a')?.note).toBe('“1”');
    expect(rows.find(r => r.id === 'b')?.note).toBe('Finished without a reply');
  });

  it('drops old finished cards but keeps open ones', () => {
    const s = snap([
      task('old', 'researcher', 'done', { completedAt: NOW - 3 * 86400 }),
      task('open', 'clerk', 'ready', { createdAt: NOW - 3 * 86400 }),
    ]);
    expect(requestRows(s).map(r => r.id)).toEqual(['open']);
  });
});

describe('teamSummary (Hermes status-bar chip)', () => {
  const label = (key: string) => ({ 'hermes.st.working': 'Working', 'hermes.st.failed': 'Failed', 'hermes.st.idle': 'Idle', 'hermes.st.waiting': 'Waiting', 'hermes.req.ago': '{t} ago' } as Record<string, string>)[key] ?? key;
  const withHomes = (s: HermesSnapshot) => ({ ...s, homes: [{ id: 'test', label: 'test', path: '/x' }], homeId: 'test', board: { slug: 'test' } }) as unknown as HermesSnapshot;

  it('leads with who is working, and words each agent', () => {
    const s = withHomes(snap([task('t1', 'clerk', 'running'), task('t2', 'editor', 'blocked', { lastFailureError: 'elapsed 50s > limit 45s', consecutiveFailures: 2 })]));
    const sum = teamSummary(s, label);
    expect(sum.headline).toEqual({ tone: 'working', text: '1 working' });
    expect(sum.counts).toMatchObject({ working: 1, failed: 1 });
    expect(sum.agents.find(a => a.id === 'editor')).toMatchObject({ label: 'Failed', detail: 'Timed out after 50s (limit 45s)' });
    expect(sum.agents[0].id).toBe('default'); // orchestrator first
  });

  it('falls back to failures, then a calm word', () => {
    expect(teamSummary(withHomes(snap([task('t', 'editor', 'blocked', { consecutiveFailures: 2 })])), label).headline).toEqual({ tone: 'bad', text: '1 failed' });
    expect(teamSummary(withHomes(snap([])), label).headline).toEqual({ tone: 'idle', text: 'Team idle' });
  });
});

describe('latestRound and the latest event (floating card)', () => {
  const withHomes = (s: HermesSnapshot) => ({ ...s, homes: [], homeId: 'test', board: null }) as unknown as HermesSnapshot;

  it('groups the newest cards one agent handed out together', () => {
    const old = task('old', 'clerk', 'done', { createdAt: NOW - 3600 });
    const round = [
      task('a', 'researcher', 'done', { createdAt: NOW - 100, completedAt: NOW - 50, reply: '1' }),
      task('b', 'clerk', 'running', { createdAt: NOW - 95 }),
      task('c', 'editor', 'blocked', { createdAt: NOW - 90, consecutiveFailures: 2 }),
      task('d', 'researcher', 'ready', { createdAt: NOW - 90 }),
    ];
    expect(latestRound(snap([old, ...round]))).toEqual({ by: 'default', startedAt: NOW - 100, total: 4, done: 1, failed: 1, working: 1, waiting: 1 });
  });

  it('has no round when nothing was handed out in the last day', () => {
    expect(latestRound(snap([task('x', 'clerk', 'done', { createdAt: NOW - 2 * 86400, completedAt: NOW - 2 * 86400 })]))).toBeNull();
  });

  it('words the newest request and gives each agent a start time', () => {
    const s = withHomes(snap([task('a', 'researcher', 'done', { createdAt: NOW - 100, completedAt: NOW - 10, reply: '1' })]));
    const sum = teamSummary(s, k => k);
    expect(sum.latest).toMatchObject({ tone: 'ok', text: 'researcher replied to default “1”', at: NOW - 10 });
    expect(sum.agents.find(a => a.id === 'researcher')?.at).toBe(NOW - 10);
  });
});

describe('failures stay visible (UI review)', () => {
  const withHomes = (s: HermesSnapshot) => ({ ...s, homes: [], homeId: 'test', board: null }) as unknown as HermesSnapshot;
  // The editor's latest card replied, but two older cards are still blocked.
  const tasks = [
    task('old1', 'editor', 'blocked', { createdAt: NOW - 5000, startedAt: NOW - 4900, consecutiveFailures: 2 }),
    task('old2', 'editor', 'blocked', { createdAt: NOW - 4000, startedAt: NOW - 3900, consecutiveFailures: 2 }),
    task('new', 'editor', 'done', { createdAt: NOW - 200, startedAt: NOW - 150, completedAt: NOW - 100, reply: 'ok' }),
  ];

  it('keeps the latest status but counts the blocked cards', () => {
    expect(agentStatus(snap(tasks), 'editor')).toMatchObject({ tone: 'ok', blockedCards: 2 });
  });

  it('never says "All replied" while cards are blocked, and flags the agent', () => {
    const sum = teamSummary(withHomes(snap(tasks)), k => k);
    expect(sum.headline).toEqual({ tone: 'bad', text: '2 blocked' });
    expect(sum.counts.blocked).toBe(2);
    expect(sum.agents.find(a => a.id === 'editor')?.alert).toBe('2 blocked');
  });
});
