// src/hooks/useWorkflowGroups.ts
// CRUD helpers for workflow groups — create, rename, recolor, delete.
// Accepts fullServerState and setter as parameters so it can share the
// single source of truth owned by useGraphState.
// Track 8b

import { useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { ServerGraphState } from '@/lib/serverState';

const GROUP_COLORS = ['#6366F1','#0EA5E9','#10B981','#F59E0B','#EF4444','#8B5CF6','#EC4899','#14B8A6'];

function put(body: Record<string, unknown>) {
  return fetch('/api/graph-state', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(console.error);
}

export function useWorkflowGroups(
  fullServerState: ServerGraphState | null,
  setFullServerState: Dispatch<SetStateAction<ServerGraphState | null>>,
  setGroupFilters: Dispatch<SetStateAction<string[]>>,
) {
  const [editingGroupId,   setEditingGroupId]   = useState<string | null>(null);
  const [editingGroupName, setEditingGroupName] = useState('');

  const workflowGroups = fullServerState?.settings?.workflowGroups ?? [];

  const createGroup = () => {
    const id    = `group-${Date.now()}`;
    const color = GROUP_COLORS[workflowGroups.length % GROUP_COLORS.length];
    const group = { id, name: 'New Group', color, nodeIds: [] };
    put({ action: 'upsertWorkflowGroup', group });
    setFullServerState(prev => prev ? {
      ...prev,
      settings: { ...prev.settings!, workflowGroups: [...(prev.settings?.workflowGroups ?? []), group] },
    } : prev);
    setEditingGroupId(id);
    setEditingGroupName('New Group');
  };

  const renameGroup = (id: string, name: string) => {
    const group = workflowGroups.find(g => g.id === id);
    if (!group) return;
    const updated = { ...group, name };
    put({ action: 'upsertWorkflowGroup', group: updated });
    setFullServerState(prev => prev ? {
      ...prev,
      settings: { ...prev.settings!, workflowGroups: (prev.settings?.workflowGroups ?? []).map(g => g.id === id ? updated : g) },
    } : prev);
  };

  const changeGroupColor = (id: string, color: string) => {
    const group = workflowGroups.find(g => g.id === id);
    if (!group) return;
    const updated = { ...group, color };
    put({ action: 'upsertWorkflowGroup', group: updated });
    setFullServerState(prev => prev ? {
      ...prev,
      settings: { ...prev.settings!, workflowGroups: (prev.settings?.workflowGroups ?? []).map(g => g.id === id ? updated : g) },
    } : prev);
  };

  const deleteGroup = (id: string) => {
    put({ action: 'deleteWorkflowGroup', groupId: id });
    setFullServerState(prev => prev ? {
      ...prev,
      settings: { ...prev.settings!, workflowGroups: (prev.settings?.workflowGroups ?? []).filter(g => g.id !== id) },
    } : prev);
    setGroupFilters(f => f.filter(gid => gid !== id));
  };

  return {
    workflowGroups,
    editingGroupId, setEditingGroupId,
    editingGroupName, setEditingGroupName,
    createGroup,
    renameGroup,
    changeGroupColor,
    deleteGroup,
    GROUP_COLORS,
  };
}
