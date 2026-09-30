// src/__tests__/hermes-layout.test.ts
// Hybrid map layout: org chart for orchestrator → workers, flow for hand-off chains.

import { describe, expect, it } from 'vitest';
import { hasChains, layoutFlow, layoutTeam, stepConnector, treeBranch } from '@/lib/hermes/layout';
import { HUMAN_ID } from '@/lib/hermes/metrics';
import type { HermesEdge, HermesProfile } from '@/lib/hermes/types';

const profile = (id: string, isDefault = false): HermesProfile =>
  ({ id, name: id, description: '', model: null, isDefault, unattended: !isDefault, disabledToolsets: [] });
const profiles = [profile('default', true), profile('assistant'), profile('researcher'), profile('editor'), profile('clerk')];
const roster: HermesEdge[] = [
  { id: `${HUMAN_ID}->default`, source: HUMAN_ID, target: 'default', kind: 'roster', count: 0 },
  ...profiles.slice(1).map(p => ({ id: `default->${p.id}`, source: 'default', target: p.id, kind: 'roster' as const, count: 1 })),
];
const chain: HermesEdge[] = [
  ...roster,
  { id: 'researcher->editor', source: 'researcher', target: 'editor', kind: 'observed', count: 1 },
  { id: 'editor->clerk', source: 'editor', target: 'clerk', kind: 'observed', count: 1 },
];

describe('hasChains', () => {
  it('is false for orchestrator → workers, true once workers hand cards to each other', () => {
    expect(hasChains(profiles, roster)).toBe(false);
    expect(hasChains(profiles, chain)).toBe(true);
  });
});

describe('layoutFlow', () => {
  it('puts each step of the chain on its own row, below You and the orchestrator', () => {
    const l = layoutFlow(profiles, chain);
    const y = (id: string) => l.nodes.get(id)!.y;
    expect(y(HUMAN_ID)).toBe(y('default'));
    expect(y('assistant')).toBe(y('researcher'));      // step 1: handed out by the orchestrator
    expect(y('editor')).toBeGreaterThan(y('researcher')); // step 2
    expect(y('clerk')).toBeGreaterThan(y('editor'));      // step 3
    expect(y('researcher')).toBe(l.firstRowY);
  });

  it('matches the org chart when there is no chain, and is stable between polls', () => {
    const a = layoutFlow(profiles, roster), b = layoutFlow(profiles, roster);
    expect([...a.nodes.values()]).toEqual([...b.nodes.values()]);
    const rows = new Set([...a.nodes.values()].filter(n => n.id !== HUMAN_ID && n.id !== 'default').map(n => n.y));
    expect(rows.size).toBe(1);
    expect(a.firstRowY).toBe(layoutTeam(profiles).firstRowY);
  });
});

describe('connectors', () => {
  it('routes a hand-off down into the next row, colouring only the straight drop', () => {
    const l = layoutFlow(profiles, chain);
    const c = stepConnector(l.nodes.get('researcher')!, l.nodes.get('editor')!)!;
    const bx = l.nodes.get('editor')!.x + 100;
    expect(c.drop.startsWith(`M${bx},`)).toBe(true);
    expect(c.branch.endsWith(`L${bx},${l.nodes.get('editor')!.y - 2}`)).toBe(true);
  });

  it('returns null for same-row hand-offs (drawn as a curve instead)', () => {
    const l = layoutTeam(profiles);
    expect(stepConnector(l.nodes.get('assistant')!, l.nodes.get('clerk')!)).toBeNull();
  });

  it('keeps the org-chart drop on the grey branch', () => {
    const l = layoutTeam(profiles);
    const tb = treeBranch(l.nodes.get('default')!, l.nodes.get('clerk')!, l.firstRowY);
    const x = l.nodes.get('clerk')!.x + 100;
    expect(tb.drop).toMatch(new RegExp(`^M${x},`));
    expect(tb.branch.endsWith(`L${x},${l.nodes.get('clerk')!.y - 2}`)).toBe(true);
  });
});
