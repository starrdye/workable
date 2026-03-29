/**
 * src/__tests__/functional-jack-workflow.test.ts 
 * Functional regression tests for the Jack & Sarah Workflow scenario.
 * Verifies that AI outputs for this specific domain pass all Zod validations.
 */

import { describe, it, expect } from 'vitest';
import { 
  ParseWorkflowResponse, 
  OptimizeResponseSchema, 
  AIUpdatePatchResponse 
} from '@/lib/aiSchemas';

describe('Jack\'s Financial Reconciliation Workflow', () => {

  // 1. Test the "Generation" phase (Initial Input)
  it('validates the initial parse of the routine', () => {
    const jackInitialState = {
      nodes: [
        { id: 'jack', name: 'Jack', initials: 'JK', role: 'person', summary: 'Operations Analyst', constraints: 'Starts at 9:00 AM. Blocked by Sarah\'s manual review.', tasks: [
          { id: 't-1', title: 'Extract Pricing Data', status: 'done', priority: 'high' },
          { id: 't-2', title: 'Upload Match Report', status: 'blocked', priority: 'high', note: 'Waiting on Sarah' }
        ]},
        { id: 'bloomberg', name: 'Bloomberg Terminal', initials: 'BT', role: 'tool', summary: 'Raw pricing data source' },
        { id: 'recon_script', name: 'Python Recon Script', initials: 'PY', role: 'tool', summary: 'Automated matching engine' },
        { id: 'postgresql_db', name: 'PostgreSQL Database', initials: 'DB', role: 'tool', summary: 'Internal reference data' },
        { id: 'exception_file', name: 'Exception File', initials: 'EF', role: 'output', summary: 'Generated if discrepancies found' },
        { id: 'sarah', name: 'Sarah', initials: 'SR', role: 'person', summary: 'Portfolio Manager', constraints: 'Manual approval required for price breaks' },
        { id: 'client_dashboard', name: 'Client Dashboard', initials: 'CD', role: 'output', summary: 'Final destination for reconciled data' }
      ],
      edges: [
        { id: 'jack-to-bt', source: 'jack', target: 'bloomberg', name: 'Login & Extract' },
        { id: 'bt-to-py', source: 'bloomberg', target: 'recon_script', name: 'CSV File Download' },
        { id: 'py-to-db', source: 'recon_script', target: 'postgresql_db', name: 'Reconciliation Check' },
        { id: 'py-to-ex', source: 'recon_script', target: 'exception_file', name: 'Generate Exceptions' },
        { id: 'ex-to-sarah', source: 'exception_file', target: 'sarah', name: 'Slack Integration' },
        { id: 'sarah-to-jack', source: 'sarah', target: 'jack', name: 'Thumbs Up / Approval' },
        { id: 'jack-to-db', source: 'jack', target: 'postgresql_db', name: 'Data Override' },
        { id: 'jack-to-cd', source: 'jack', target: 'client_dashboard', name: 'Push Corrected Data' },
        { id: 'py-to-cd', source: 'recon_script', target: 'client_dashboard', name: 'Auto-Upload Match Report' }
      ],
      groups: [
        { id: 'recon_team', name: 'Morning Reconciliation', color: '#6366F1', nodeIds: ['jack', 'bloomberg', 'recon_script', 'postgresql_db'] }
      ]
    };

    const result = ParseWorkflowResponse.safeParse(jackInitialState);
    if (!result.success) {
      console.error(JSON.stringify(result.error.format(), null, 2));
    }
    expect(result.success).toBe(true);
  });

  // 2. Test the "Analysis" phase (Optimization suggestions)
  it('validates the AI analysis of the Jack-Sarah bottleneck', () => {
    const analysisOutput = {
      analysis: '## Bottleneck Identified: Sarah\nJack is explicitly blocked waiting for manual review of Exception Files. This creates a high latency path.',
      suggestedConnections: [
        { 
          sourceId: 'recon_script', sourceName: 'Python Recon Script', 
          targetId: 'jack', targetName: 'Jack', 
          connectionName: 'Auto-Bypass', reason: 'Direct path for Match Reports without Sarah intervention.',
          cascadeEffects: [
            { id: 'jack', type: 'stable', description: 'Reconciliation is no longer blocked by Sarah.', depth: 1 }
          ]
        }
      ],
      suggestedRemovals: [
        { type: 'node', id: 'sarah', name: 'Sarah', action: 'automate', reason: 'Manual review can be partially digitized via auto-thresholds.' }
      ],
      suggestionPlan: {
        phases: [
          { phaseIndex: 1, label: 'Bypass for Clean Data', description: 'Enable direct upload for Match Reports.', prerequisitePhases: [], suggestionRefs: [{ type: 'connection', refId: 'recon_script-jack' }] }
        ]
      }
    };

    const result = OptimizeResponseSchema.safeParse(analysisOutput);
    if (!result.success) {
      console.error(JSON.stringify(result.error.format(), null, 2));
    }
    expect(result.success).toBe(true);
  });

  // 3. Test the "Update" phase (Adding HR Layer)
  it('validates a patch adding Mary and Jason', () => {
    const hrUpdatePatch = {
      add: {
        nodes: [
          { id: 'mary', name: 'Mary', initials: 'MY', role: 'person', summary: 'HR Representative' },
          { id: 'jason', name: 'Jason', initials: 'JS', role: 'person', summary: 'Mary’s Supervisor' }
        ],
        edges: [
          { id: 'mary-to-jack', source: 'mary', target: 'jack', name: 'Wellness Evaluation' },
          { id: 'jason-to-mary', source: 'jason', target: 'mary', name: 'Supervision' },
          { id: 'jason-to-jack', source: 'jason', target: 'jack', name: 'Joint Supervision Talk' },
          { id: 'mary-to-sarah', source: 'mary', target: 'sarah', name: 'Performance Sync' }
        ],
        groups: [
          { id: 'hr_management', name: 'Management Layer', color: '#10B981', nodeIds: ['mary', 'jason'] }
        ]
      },
      update: {
        nodeTasks: [
          {
            nodeId: 'jack',
            tasks: [
              { id: 't-wellness', title: 'Weekly Wellness Check-in', status: 'todo', priority: 'medium', note: 'With Mary' }
            ]
          }
        ]
      }
    };

    const result = AIUpdatePatchResponse.safeParse(hrUpdatePatch);
    if (!result.success) {
      console.error(JSON.stringify(result.error.format(), null, 2));
    }
    expect(result.success).toBe(true);
  });
});
