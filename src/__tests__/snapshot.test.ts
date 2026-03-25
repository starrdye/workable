// src/__tests__/snapshot.test.ts
// Regression tests for snapshotBuilder.ts (Track 14b-i: Hierarchical Group Summaries).
// Covers both buildOptimizeSnapshot and buildUpdateSnapshot.

import { describe, it, expect } from 'vitest';
import {
  buildRoleSummary,
  buildGroupIdLookup,
  buildOptimizeSnapshot,
  buildUpdateSnapshot,
} from '@/lib/snapshotBuilder';
import type { ServerGraphState } from '@/lib/serverState';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Minimal valid ServerGraphState with no customNodes/Edges/groups. */
function makeState(overrides: Partial<ServerGraphState> = {}): ServerGraphState {
  return {
    baselinePositions:          {},
    ecosystemPositions:         {},
    originalBaselinePositions:  {},
    originalEcosystemPositions: {},
    customNodes:  [],
    customEdges:  [],
    settings: {
      nodePause:           0,
      edgeWeightOverrides: {},
      nodeDelayOverrides:  {},
      metadataOverrides:   {},
    },
    lastUpdated: 0,
    ...overrides,
  };
}

/** Minimal workflowData object for buildOptimizeSnapshot. */
function makeWorkflowData(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    customNodes: [],
    customEdges: [],
    settings: {
      metadataOverrides: {},
      hiddenCoreNodes:   [],
      workflowGroups:    [],
    },
    ...overrides,
  };
}

// ─── buildRoleSummary ─────────────────────────────────────────────────────────

describe('buildRoleSummary', () => {
  it('returns "empty" for an empty role array', () => {
    expect(buildRoleSummary([])).toBe('empty');
  });

  it('formats a single role correctly', () => {
    expect(buildRoleSummary(['person'])).toBe('1 person');
  });

  it('counts multiple same roles', () => {
    expect(buildRoleSummary(['person', 'person', 'person'])).toBe('3 person');
  });

  it('handles mixed roles', () => {
    const result = buildRoleSummary(['person', 'tool', 'person']);
    // Should contain "2 person" and "1 tool"
    expect(result).toContain('2 person');
    expect(result).toContain('1 tool');
  });

  it('normalises role strings to lowercase', () => {
    expect(buildRoleSummary(['Person', 'TOOL'])).toContain('1 person');
    expect(buildRoleSummary(['Person', 'TOOL'])).toContain('1 tool');
  });
});

// ─── buildGroupIdLookup ───────────────────────────────────────────────────────

describe('buildGroupIdLookup', () => {
  it('returns empty lookup for no groups', () => {
    expect(buildGroupIdLookup([])).toEqual({});
  });

  it('maps each node to its group ID', () => {
    const groups = [{ id: 'grp_a', nodeIds: ['nav', 'xy'] }];
    const lookup = buildGroupIdLookup(groups);
    expect(lookup['nav']).toEqual(['grp_a']);
    expect(lookup['xy']).toEqual(['grp_a']);
    expect(lookup['mary']).toBeUndefined();
  });

  it('supports a node belonging to multiple groups', () => {
    const groups = [
      { id: 'grp_a', nodeIds: ['nav', 'mary'] },
      { id: 'grp_b', nodeIds: ['mary', 'ed'] },
    ];
    const lookup = buildGroupIdLookup(groups);
    expect(lookup['mary']).toEqual(['grp_a', 'grp_b']);
  });

  it('uses IDs not names', () => {
    const groups = [{ id: 'grp_compliance', nodeIds: ['ed'] }];
    const lookup = buildGroupIdLookup(groups);
    // The value must be an array of ID strings, not name strings
    expect(lookup['ed']).toEqual(['grp_compliance']);
    // Must NOT contain a group name like "Compliance Team"
    expect(lookup['ed']).not.toContain('Compliance Team');
  });
});

// ─── buildOptimizeSnapshot — group ID references ──────────────────────────────

describe('buildOptimizeSnapshot — group IDs on nodes', () => {
  const workflowData = makeWorkflowData({
    settings: {
      metadataOverrides: {},
      hiddenCoreNodes:   [],
      workflowGroups: [
        { id: 'grp_review', name: 'Review Team', color: '#6366F1', nodeIds: ['mary', 'ed'] },
      ],
    },
  });

  it('assigns groupIds (not group names) to member core nodes', () => {
    const { coreNodes } = buildOptimizeSnapshot(workflowData);
    const mary = coreNodes.find(n => n.id === 'mary');
    const ed   = coreNodes.find(n => n.id === 'ed');
    expect(mary?.groupIds).toEqual(['grp_review']);
    expect(ed?.groupIds).toEqual(['grp_review']);
  });

  it('does NOT include the group display name in node groupIds', () => {
    const { coreNodes } = buildOptimizeSnapshot(workflowData);
    const mary = coreNodes.find(n => n.id === 'mary');
    expect(mary?.groupIds).not.toContain('Review Team');
  });

  it('leaves groupIds undefined on nodes that belong to no group', () => {
    const { coreNodes } = buildOptimizeSnapshot(workflowData);
    const nav = coreNodes.find(n => n.id === 'nav');
    expect(nav?.groupIds).toBeUndefined();
  });
});

// ─── buildOptimizeSnapshot — enriched groupSummary ───────────────────────────

describe('buildOptimizeSnapshot — enriched groupSummary', () => {
  it('includes nodeCount, roleSummary, constraintCount in each group entry', () => {
    const workflowData = makeWorkflowData({
      settings: {
        metadataOverrides: {
          // Give ed a constraint to test constraintCount
          ed: { constraints: 'Must approve within 24 hours' },
        },
        hiddenCoreNodes: [],
        workflowGroups: [
          { id: 'grp_a', name: 'Approval', color: '#0EA5E9', nodeIds: ['mary', 'ed'] },
        ],
      },
    });

    const { groupSummary } = buildOptimizeSnapshot(workflowData);
    expect(groupSummary).toHaveLength(1);
    const g = groupSummary[0];
    expect(g.nodeCount).toBe(2);
    expect(g.roleSummary).toBeTruthy();     // e.g. "1 collaborator, 1 manager"
    expect(g.constraintCount).toBe(1);      // only ed has a constraint
    expect(g.id).toBe('grp_a');
    expect(g.name).toBe('Approval');
    expect(g.members).toContain('Mary');
    expect(g.members).toContain('Edward');
  });

  it('nodeCount matches nodeIds.length', () => {
    const workflowData = makeWorkflowData({
      settings: {
        metadataOverrides: {},
        hiddenCoreNodes:   [],
        workflowGroups: [
          { id: 'grp_all', name: 'All Core', color: '#10B981', nodeIds: ['nav', 'script', 'db', 'xy', 'mary'] },
        ],
      },
    });
    const { groupSummary } = buildOptimizeSnapshot(workflowData);
    expect(groupSummary[0].nodeCount).toBe(5);
  });

  it('handles an empty group (nodeIds: []) without crashing', () => {
    const workflowData = makeWorkflowData({
      settings: {
        metadataOverrides: {},
        hiddenCoreNodes:   [],
        workflowGroups: [
          { id: 'grp_empty', name: 'Empty Group', color: '#6366F1', nodeIds: [] },
        ],
      },
    });
    const { groupSummary } = buildOptimizeSnapshot(workflowData);
    expect(groupSummary[0].nodeCount).toBe(0);
    expect(groupSummary[0].roleSummary).toBe('empty');
    expect(groupSummary[0].constraintCount).toBe(0);
  });

  it('constraintCount is 0 when no members have constraints', () => {
    const workflowData = makeWorkflowData({
      settings: {
        metadataOverrides: {},   // no constraints
        hiddenCoreNodes:   [],
        workflowGroups: [
          { id: 'grp_noconstrain', name: 'No Constraints', color: '#F59E0B', nodeIds: ['nav', 'xy'] },
        ],
      },
    });
    const { groupSummary } = buildOptimizeSnapshot(workflowData);
    expect(groupSummary[0].constraintCount).toBe(0);
  });
});

// ─── buildOptimizeSnapshot — hidden nodes ─────────────────────────────────────

describe('buildOptimizeSnapshot — hidden nodes', () => {
  it('excludes hidden core nodes from coreNodes', () => {
    const workflowData = makeWorkflowData({
      settings: {
        metadataOverrides: {},
        hiddenCoreNodes:   ['nav', 'script', 'db'],
        workflowGroups:    [],
      },
    });
    const { coreNodes } = buildOptimizeSnapshot(workflowData);
    const ids = coreNodes.map(n => n.id);
    expect(ids).not.toContain('nav');
    expect(ids).not.toContain('script');
    expect(ids).not.toContain('db');
    expect(ids).toContain('xy');
    expect(ids).toContain('mary');
  });

  it('filters core edges where BOTH endpoints are hidden', () => {
    const workflowData = makeWorkflowData({
      settings: {
        metadataOverrides: {},
        // nav and xy both hidden → nav-xy edge should be excluded
        hiddenCoreNodes:   ['nav', 'xy'],
        workflowGroups:    [],
      },
    });
    const { coreEdges } = buildOptimizeSnapshot(workflowData);
    const ids = coreEdges.map(e => e.id);
    // nav-xy: both endpoints hidden → excluded
    expect(ids).not.toContain('nav-xy');
    // xy-mary: xy is hidden but mary is not → included
    expect(ids).toContain('xy-mary');
  });
});

// ─── buildOptimizeSnapshot — improvement-only edges ──────────────────────────

describe('buildOptimizeSnapshot — improvement-only edges excluded', () => {
  it('strips isImprovementOnly custom edges', () => {
    const workflowData = makeWorkflowData({
      customEdges: [
        { id: 'custom_1', source: 'mary', target: 'cy', isImprovementOnly: true,  name: 'Direct' },
        { id: 'custom_2', source: 'mary', target: 'ed', isImprovementOnly: false, name: 'Escalation' },
      ],
      settings: {
        metadataOverrides: {},
        hiddenCoreNodes:   [],
        workflowGroups:    [],
      },
    });
    const { customEdges } = buildOptimizeSnapshot(workflowData);
    expect(customEdges.find(e => e.id === 'custom_1')).toBeUndefined();
    expect(customEdges.find(e => e.id === 'custom_2')).toBeDefined();
  });
});

// ─── buildOptimizeSnapshot — custom nodes with groupIds ──────────────────────

describe('buildOptimizeSnapshot — custom nodes group IDs', () => {
  it('assigns groupIds to custom nodes that belong to a group', () => {
    const workflowData = makeWorkflowData({
      customNodes: [
        { id: 'upd_alice', label: 'Alice', role: 'person' },
      ],
      settings: {
        metadataOverrides: {},
        hiddenCoreNodes:   [],
        workflowGroups: [
          { id: 'grp_team', name: 'Team Alpha', color: '#8B5CF6', nodeIds: ['upd_alice'] },
        ],
      },
    });
    const { customNodes } = buildOptimizeSnapshot(workflowData);
    const alice = customNodes.find(n => n.id === 'upd_alice');
    expect(alice?.groupIds).toEqual(['grp_team']);
  });
});

// ─── buildUpdateSnapshot — node Groups line uses IDs ─────────────────────────

describe('buildUpdateSnapshot — node Groups line', () => {
  it('lists group IDs (not names) on the Groups: line for core nodes', () => {
    const state = makeState({
      settings: {
        nodePause:           0,
        edgeWeightOverrides: {},
        nodeDelayOverrides:  {},
        metadataOverrides:   {},
        workflowGroups: [
          { id: 'grp_ops', name: 'Operations Team', color: '#6366F1', nodeIds: ['xy'] },
        ],
      },
    });

    const snapshot = buildUpdateSnapshot(state);
    // The Groups: line for xy should show the group ID, not the group name
    expect(snapshot).toContain('Groups: grp_ops');
    // Must NOT show the display name on the per-node Groups line
    // (The name does appear in the GROUPS section header — that is correct)
    const xyBlock = snapshot.split('\n').find(line => line.includes('[xy]'));
    expect(xyBlock).toBeDefined();
    // Find the Groups: line that follows [xy]
    const lines   = snapshot.split('\n');
    const xyIdx   = lines.findIndex(l => l.includes('[xy]'));
    const grpLine = lines.slice(xyIdx).find(l => l.trim().startsWith('Groups:'));
    expect(grpLine).toContain('grp_ops');
    expect(grpLine).not.toContain('Operations Team');
  });

  it('shows "–" on the Groups line for nodes in no group', () => {
    const state = makeState();
    const snapshot = buildUpdateSnapshot(state);
    // Every core node should show Groups: – since there are no groups
    expect(snapshot).toContain('Groups: –');
  });
});

// ─── buildUpdateSnapshot — GROUPS section enrichment ─────────────────────────

describe('buildUpdateSnapshot — enriched GROUPS section', () => {
  it('appends Nodes/Roles/Constraints summary line for each group', () => {
    const state = makeState({
      settings: {
        nodePause:           0,
        edgeWeightOverrides: {},
        nodeDelayOverrides:  {},
        metadataOverrides: {
          ed: { constraints: 'Requires sign-off within 48h' },
        },
        workflowGroups: [
          { id: 'grp_approval', name: 'Approval Chain', color: '#EF4444', nodeIds: ['mary', 'ed'] },
        ],
      },
    });

    const snapshot = buildUpdateSnapshot(state);
    // The group header line
    expect(snapshot).toContain('[grp_approval]  Approval Chain  color:#EF4444');
    // The enriched summary line
    expect(snapshot).toContain('Nodes: 2');
    expect(snapshot).toContain('Constraints: 1');
  });

  it('shows "(none)" when there are no groups', () => {
    const snapshot = buildUpdateSnapshot(makeState());
    expect(snapshot).toContain('GROUPS (0)');
    expect(snapshot).toContain('(none)');
  });

  it('correctly counts zero constraints when no members have any', () => {
    const state = makeState({
      settings: {
        nodePause:           0,
        edgeWeightOverrides: {},
        nodeDelayOverrides:  {},
        metadataOverrides:   {},
        workflowGroups: [
          { id: 'grp_data', name: 'Data Layer', color: '#0EA5E9', nodeIds: ['nav', 'script', 'db'] },
        ],
      },
    });
    const snapshot = buildUpdateSnapshot(state);
    expect(snapshot).toContain('Constraints: 0');
  });
});

// ─── buildUpdateSnapshot — tasks formatting ───────────────────────────────────

describe('buildUpdateSnapshot — tasks', () => {
  it('formats tasks under a node when present', () => {
    const state = makeState({
      settings: {
        nodePause:           0,
        edgeWeightOverrides: {},
        nodeDelayOverrides:  {},
        metadataOverrides: {
          mary: {
            tasks: [
              { id: 't_abc123', title: 'Review draft report', status: 'todo', priority: 'high' },
              { id: 't_def456', title: 'Sign off', status: 'in-progress', priority: 'medium', note: 'Pending' },
            ],
          },
        },
      },
    });

    const snapshot = buildUpdateSnapshot(state);
    expect(snapshot).toContain('Tasks (2):');
    expect(snapshot).toContain('[t_abc123] Review draft report  status:todo  priority:high');
    expect(snapshot).toContain('[t_def456] Sign off  status:in-progress  priority:medium  — Pending');
  });

  it('omits Tasks section for nodes with no tasks', () => {
    const snapshot = buildUpdateSnapshot(makeState());
    expect(snapshot).not.toContain('Tasks (');
  });
});

// ─── buildUpdateSnapshot — constraints ───────────────────────────────────────

describe('buildUpdateSnapshot — constraints', () => {
  it('shows Constraints line for nodes with a constraints override', () => {
    const state = makeState({
      settings: {
        nodePause:           0,
        edgeWeightOverrides: {},
        nodeDelayOverrides:  {},
        metadataOverrides: {
          ed: { constraints: 'Only available Mon–Fri 9–5' },
        },
      },
    });
    const snapshot = buildUpdateSnapshot(state);
    expect(snapshot).toContain('Constraints: Only available Mon–Fri 9–5');
  });

  it('omits Constraints line when no constraint is set', () => {
    const snapshot = buildUpdateSnapshot(makeState());
    expect(snapshot).not.toContain('Constraints:');
  });
});

// ─── buildUpdateSnapshot — custom nodes & edges ───────────────────────────────

describe('buildUpdateSnapshot — custom nodes and edges', () => {
  it('includes custom nodes with correct label and role', () => {
    const state = makeState({
      customNodes: [
        {
          id: 'upd_bob', labelInitials: 'BO', label: 'Bob', nodeType: 'neural',
          role: 'person', position: { x: 100, y: 200 },
        },
      ],
    });
    const snapshot = buildUpdateSnapshot(state);
    expect(snapshot).toContain('[upd_bob]  Bob  (person)');
  });

  it('includes custom edges in the EDGES section', () => {
    const state = makeState({
      customEdges: [
        { id: 'upd_e_xy_bob', source: 'xy', target: 'upd_bob', name: 'Handoff' },
      ],
      customNodes: [
        {
          id: 'upd_bob', labelInitials: 'BO', label: 'Bob', nodeType: 'neural',
          role: 'person', position: { x: 100, y: 200 },
        },
      ],
    });
    const snapshot = buildUpdateSnapshot(state);
    expect(snapshot).toContain('[upd_e_xy_bob]');
    expect(snapshot).toContain('"Handoff"');
  });
});

// ─── workflowSnapshot JSON roundtrip ─────────────────────────────────────────

describe('buildOptimizeSnapshot — workflowSnapshot JSON integrity', () => {
  it('produces valid JSON for the workflowSnapshot field', () => {
    const { workflowSnapshot } = buildOptimizeSnapshot(makeWorkflowData());
    expect(() => JSON.parse(workflowSnapshot)).not.toThrow();
  });

  it('workflowSnapshot groups array matches groupSummary', () => {
    const workflowData = makeWorkflowData({
      settings: {
        metadataOverrides: {},
        hiddenCoreNodes:   [],
        workflowGroups: [
          { id: 'grp_x', name: 'Group X', color: '#10B981', nodeIds: ['nav'] },
        ],
      },
    });
    const { workflowSnapshot, groupSummary } = buildOptimizeSnapshot(workflowData);
    const parsed = JSON.parse(workflowSnapshot) as { groups: typeof groupSummary };
    expect(parsed.groups).toHaveLength(1);
    expect(parsed.groups[0].id).toBe('grp_x');
    expect(parsed.groups[0].nodeCount).toBe(1);
  });
});
