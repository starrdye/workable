// src/__tests__/csv.test.ts
// CSV round-trip tests for buildCsvExport / parseCsvImport.
// Track 8a

import { describe, it, expect } from 'vitest';
import { buildCsvExport, parseCsvImport, csvCell, csvRow, parseCsvRow } from '@/lib/csvHelpers';
import type { CsvNode, CsvCustomNode, CsvCustomEdge, CsvSettings } from '@/lib/csvHelpers';

// ─── csvCell / csvRow / parseCsvRow ───────────────────────────────────────────

describe('csvCell', () => {
  it('passes through plain strings without quoting', () => {
    expect(csvCell('hello')).toBe('hello');
    expect(csvCell(42)).toBe('42');
  });

  it('wraps strings that contain commas in double-quotes', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
  });

  it('escapes double-quotes by doubling them', () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
  });

  it('wraps strings that contain newlines', () => {
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
  });
});

describe('parseCsvRow', () => {
  it('splits a simple comma-separated row', () => {
    expect(parseCsvRow('a,b,c')).toEqual(['a', 'b', 'c']);
  });

  it('handles quoted fields with commas', () => {
    expect(parseCsvRow('"a,b",c')).toEqual(['a,b', 'c']);
  });

  it('handles escaped double-quotes inside quoted fields', () => {
    expect(parseCsvRow('"say ""hi"""')).toEqual(['say "hi"']);
  });

  it('round-trips through csvRow', () => {
    const original = ['hello', 'world,with,commas', 'say "hi"'];
    const line = csvRow(...original);
    expect(parseCsvRow(line)).toEqual(original);
  });
});

// ─── buildCsvExport / parseCsvImport round-trip ───────────────────────────────

function makeTestFixture() {
  const customNodes: CsvCustomNode[] = [
    {
      id: 'node_a', labelInitials: 'NA', label: 'Node Alpha',
      nodeType: 'neural', role: 'person', source: 'ai-generated',
      position: { x: 100, y: 200 },
    },
    {
      id: 'node_b', labelInitials: 'NB', label: 'Node Beta',
      nodeType: 'neural', role: 'tool', source: 'user-added',
      position: { x: 300, y: 400 },
    },
  ];

  const processMapNodes: CsvNode[] = customNodes.map(n => ({
    id: n.id, x: n.position.x, y: n.position.y,
    initials: n.labelInitials, label: n.label,
  }));

  const customEdges: CsvCustomEdge[] = [
    { id: 'e1', source: 'node_a', target: 'node_b', sequence: 2, weight: 1.5, isCustom: true },
  ];

  const settings: CsvSettings = {
    nodePause: 1.5,
    edgeWeightOverrides: {
      'e1': { sequence: 2, weight: 1.5 },
    },
    nodeDelayOverrides: { 'node_a': 3 },
    hiddenCoreNodes: ['nav', 'script'],
    workflowGroups: [
      { id: 'grp_test', name: 'Test Group', color: '#6366F1', nodeIds: ['node_a'] },
    ],
  };

  const edgesWithParams = [
    { id: 'e1', source: 'node_a', target: 'node_b', sequence: 2, weight: 1.5 },
  ];

  return { customNodes, processMapNodes, customEdges, settings, edgesWithParams };
}

describe('CSV round-trip', () => {
  it('preserves custom nodes after export → import', () => {
    const { customNodes, processMapNodes, customEdges, settings, edgesWithParams } = makeTestFixture();
    const csv = buildCsvExport(processMapNodes, customNodes, customEdges, settings, edgesWithParams);
    const parsed = parseCsvImport(csv);

    expect(parsed.customNodes).toHaveLength(2);
    const nodeA = parsed.customNodes.find(n => n.id === 'node_a');
    expect(nodeA).toBeDefined();
    expect(nodeA!.label).toBe('Node Alpha');
    expect(nodeA!.labelInitials).toBe('NA');
    expect(nodeA!.role).toBe('person');
    expect(nodeA!.source).toBe('ai-generated');
  });

  it('preserves custom edges after export → import', () => {
    const { customNodes, processMapNodes, customEdges, settings, edgesWithParams } = makeTestFixture();
    const csv = buildCsvExport(processMapNodes, customNodes, customEdges, settings, edgesWithParams);
    const parsed = parseCsvImport(csv);

    expect(parsed.customEdges).toHaveLength(1);
    const edge = parsed.customEdges[0];
    expect(edge.id).toBe('e1');
    expect(edge.source).toBe('node_a');
    expect(edge.target).toBe('node_b');
    expect(edge.sequence).toBe(2);
    expect(edge.weight).toBeCloseTo(1.5);
  });

  it('preserves baseline positions for custom nodes', () => {
    const { customNodes, processMapNodes, customEdges, settings, edgesWithParams } = makeTestFixture();
    const csv = buildCsvExport(processMapNodes, customNodes, customEdges, settings, edgesWithParams);
    const parsed = parseCsvImport(csv);

    expect(parsed.baselinePositions['node_a']).toEqual({ x: 100, y: 200 });
    expect(parsed.baselinePositions['node_b']).toEqual({ x: 300, y: 400 });
  });

  it('preserves settings (nodePause, nodeDelay overrides)', () => {
    const { customNodes, processMapNodes, customEdges, settings, edgesWithParams } = makeTestFixture();
    const csv = buildCsvExport(processMapNodes, customNodes, customEdges, settings, edgesWithParams);
    const parsed = parseCsvImport(csv);

    expect(parsed.settings.nodePause).toBeCloseTo(1.5);
    expect(parsed.settings.nodeDelayOverrides?.['node_a']).toBe(3);
  });

  it('preserves hidden core nodes list', () => {
    const { customNodes, processMapNodes, customEdges, settings, edgesWithParams } = makeTestFixture();
    const csv = buildCsvExport(processMapNodes, customNodes, customEdges, settings, edgesWithParams);
    const parsed = parseCsvImport(csv);

    expect(parsed.settings.hiddenCoreNodes).toContain('nav');
    expect(parsed.settings.hiddenCoreNodes).toContain('script');
  });

  it('preserves workflow groups', () => {
    const { customNodes, processMapNodes, customEdges, settings, edgesWithParams } = makeTestFixture();
    const csv = buildCsvExport(processMapNodes, customNodes, customEdges, settings, edgesWithParams);
    const parsed = parseCsvImport(csv);

    expect(parsed.settings.workflowGroups).toHaveLength(1);
    const grp = parsed.settings.workflowGroups![0];
    expect(grp.id).toBe('grp_test');
    expect(grp.name).toBe('Test Group');
    expect(grp.color).toBe('#6366F1');
    expect(grp.nodeIds).toContain('node_a');
  });

  it('handles empty graph gracefully', () => {
    const settings: CsvSettings = { nodePause: 1, edgeWeightOverrides: {}, nodeDelayOverrides: {} };
    const csv = buildCsvExport([], [], [], settings, []);
    const parsed = parseCsvImport(csv);
    expect(parsed.customNodes).toHaveLength(0);
    expect(parsed.customEdges).toHaveLength(0);
  });

  it('produces valid CSV text (no parse errors)', () => {
    const { customNodes, processMapNodes, customEdges, settings, edgesWithParams } = makeTestFixture();
    const csv = buildCsvExport(processMapNodes, customNodes, customEdges, settings, edgesWithParams);
    // Should not throw
    expect(() => parseCsvImport(csv)).not.toThrow();
  });
});
