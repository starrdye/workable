// src/hooks/useAIHandlers.ts
// All AI-related state and handlers: settings, analyze, update, apply, debug log.
// Receives shared state as parameters so mutations propagate back to the page.
// Track 8b — vb0.2: delegates to useAIEngine for mode-aware routing.

import { useState, useEffect } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { loadAIConfig, type AIConfig, AI_CONFIG_KEY } from '@/components/AISettingsModal';
import { PROVIDERS, type AIProvider } from '@/lib/aiClient';
import type { ServerGraphState } from '@/lib/serverState';
import type { SuggestedConnection, SuggestedRemoval, SuggestedEdgeRemoval, SuggestedNewNode, SuggestedTaskUpdate, SuggestedGroupUpdate, SuggestionPhase } from '@/components/AIAnalysisModal';
import type { AIUpdateResult } from '@/components/AIUpdateModal';
import type { AIDebugLog } from '@/components/StartScreen';
import { useAIEngine } from './useAIEngine';

function put(body: Record<string, unknown>) {
  return fetch('/api/graph-state', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(console.error);
}

export function useAIHandlers(
  fullServerState: ServerGraphState | null,
  setFullServerState: Dispatch<SetStateAction<ServerGraphState | null>>,
  selectedId: string | null,
  setSelectedId: Dispatch<SetStateAction<string | null>>,
  setSelectedType: Dispatch<SetStateAction<'node' | 'edge' | null>>,
  pushSnapshot: (state: ServerGraphState) => void,
  onCanvasMutation?: () => void,
) {
  // ── AI Config ──────────────────────────────────────────────────────────────
  const [aiConfig, setAiConfig] = useState<AIConfig>(() => ({
    provider: 'anthropic' as AIProvider,
    models: Object.fromEntries(PROVIDERS.map(p => [p.id, p.defaultModel])) as Record<AIProvider, string>,
    keys:   Object.fromEntries(PROVIDERS.map(p => [p.id, ''])) as Record<AIProvider, string>,
  }));

  useEffect(() => { setAiConfig(loadAIConfig()); }, []);

  const handleSaveAiConfig = (config: AIConfig) => {
    setAiConfig(config);
    localStorage.setItem(AI_CONFIG_KEY, JSON.stringify(config));
  };

  const activeApiKey = aiConfig.keys[aiConfig.provider]?.trim() ?? '';

  // ── Modal visibility ───────────────────────────────────────────────────────
  const [showAISettings,  setShowAISettings]  = useState(false);
  const [showAIAnalysis,  setShowAIAnalysis]  = useState(false);
  const [showAIUpdate,    setShowAIUpdate]    = useState(false);
  const [showDebugLog,    setShowDebugLog]    = useState(false);

  // ── AI Analyze state ───────────────────────────────────────────────────────
  const [aiAnalysis,            setAiAnalysis]            = useState<string | null>(null);
  const [aiAnalysisLoading,     setAiAnalysisLoading]     = useState(false);
  const [aiAnalysisError,       setAiAnalysisError]       = useState<string | null>(null);
  const [aiSuggestedConnections,setAiSuggestedConnections] = useState<SuggestedConnection[]>([]);
  const [aiSuggestedRemovals,   setAiSuggestedRemovals]   = useState<SuggestedRemoval[]>([]);
  const [aiAnalysisTimestamp,   setAiAnalysisTimestamp]   = useState<number | null>(null);
  const [aiSuggestedEdgeRemovals,  setAiSuggestedEdgeRemovals]  = useState<SuggestedEdgeRemoval[]>([]);
  const [aiSuggestedNewNodes,      setAiSuggestedNewNodes]      = useState<SuggestedNewNode[]>([]);
  const [aiSuggestedTaskUpdates,   setAiSuggestedTaskUpdates]   = useState<SuggestedTaskUpdate[]>([]);
  const [aiSuggestionPlan,         setAiSuggestionPlan]         = useState<{ phases: SuggestionPhase[] } | null>(null);
  const [aiSuggestedGroupUpdates,  setAiSuggestedGroupUpdates]  = useState<SuggestedGroupUpdate[]>([]);

  // Track which suggestions have already been applied so canvas can remove highlights
  const [appliedRemovalIds,     setAppliedRemovalIds]     = useState<Set<string>>(() => new Set());
  const [appliedConnectionKeys, setAppliedConnectionKeys] = useState<Set<string>>(() => new Set());
  const [appliedEdgeRemovalIds, setAppliedEdgeRemovalIds] = useState<Set<string>>(() => new Set());

  // ── AI Update state ────────────────────────────────────────────────────────
  const [aiUpdateLoading, setAiUpdateLoading] = useState(false);
  const [aiUpdateResult,  setAiUpdateResult]  = useState<AIUpdateResult | null>(null);
  const [aiUpdateError,   setAiUpdateError]   = useState<string | null>(null);

  // ── Debug log ──────────────────────────────────────────────────────────────
  const [aiDebugLog, setAiDebugLog] = useState<AIDebugLog | null>(null);

  // ── AI Engine (vb0.2: mode-aware routing with abort handling) ─────────────
  const aiEngine = useAIEngine();

  // ── Handlers ──────────────────────────────────────────────────────────────

  // Core fetch — called by both handleAiAnalyze (first time) and handleReAnalyze
  // Routes through useAIEngine which injects the current engine mode and handles
  // abort/race conditions when the user toggles mode mid-flight.
  const runAnalyze = async () => {
    setAiAnalysisError(null);
    setAiAnalysisLoading(true);
    try {
      const { data, aborted } = await aiEngine.runAnalyze(
        fullServerState,
        {
          apiKey:   activeApiKey,
          provider: aiConfig.provider,
          model:    aiConfig.models[aiConfig.provider],
          baseUrl:  aiConfig.baseUrls?.[aiConfig.provider],
        },
      );

      // If aborted (mode toggled mid-flight), silently discard
      if (aborted) {
        setAiAnalysisLoading(false);
        return;
      }

      setAiAnalysis(data.analysis as string);
      setAiSuggestedConnections((data.suggestedConnections ?? []) as SuggestedConnection[]);
      setAiSuggestedRemovals((data.suggestedRemovals ?? []) as SuggestedRemoval[]);
      setAiSuggestedEdgeRemovals((data.suggestedEdgeRemovals ?? []) as SuggestedEdgeRemoval[]);
      setAiSuggestedNewNodes((data.suggestedNewNodes ?? []) as SuggestedNewNode[]);
      setAiSuggestedTaskUpdates((data.suggestedTaskUpdates ?? []) as SuggestedTaskUpdate[]);
      setAiSuggestedGroupUpdates((data.suggestedGroupUpdates ?? []) as SuggestedGroupUpdate[]);
      setAiSuggestionPlan((data.suggestionPlan ?? null) as { phases: SuggestionPhase[] } | null);
      setAiAnalysisTimestamp(Date.now());
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Network error. Please try again.';
      setAiAnalysisError(msg);
    } finally {
      setAiAnalysisLoading(false);
    }
  };

  // Opens the modal; only auto-fetches when no cached result exists
  const handleAiAnalyze = async () => {
    if (!activeApiKey) { setShowAISettings(true); return; }
    setShowAIAnalysis(true);
    if (!aiAnalysis && !aiAnalysisError && !aiAnalysisLoading) {
      await runAnalyze();
    }
  };

  // Re-run fresh analysis, clearing the previous result and applied tracking
  const handleReAnalyze = async () => {
    setAiAnalysis(null);
    setAiSuggestedConnections([]);
    setAiSuggestedRemovals([]);
    setAiAnalysisTimestamp(null);
    setAppliedRemovalIds(new Set());
    setAppliedConnectionKeys(new Set());
    setAppliedEdgeRemovalIds(new Set());
    setAiSuggestedEdgeRemovals([]);
    setAiSuggestedNewNodes([]);
    setAiSuggestedTaskUpdates([]);
    setAiSuggestedGroupUpdates([]);
    setAiSuggestionPlan(null);
    await runAnalyze();
  };

  const handleAiUpdate = async (prompt: string) => {
    if (!activeApiKey) { setShowAISettings(true); return; }
    setAiUpdateResult(null);
    setAiUpdateError(null);
    setAiUpdateLoading(true);
    try {
      const { data, aborted } = await aiEngine.runUpdate(
        prompt,
        fullServerState,
        {
          apiKey:   activeApiKey,
          provider: aiConfig.provider,
          model:    aiConfig.models[aiConfig.provider],
          baseUrl:  aiConfig.baseUrls?.[aiConfig.provider],
        },
      );

      // If aborted (mode toggled mid-flight), silently discard
      if (aborted) {
        setAiUpdateLoading(false);
        return;
      }

      setAiUpdateResult(data as unknown as AIUpdateResult);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Network error. Please try again.';
      setAiUpdateError(msg);
    } finally {
      setAiUpdateLoading(false);
    }
  };

  const handleApplyUpdate = async (result: AIUpdateResult) => {
    // Snapshot before applying so the user can undo the whole AI patch in one step
    if (fullServerState) pushSnapshot(fullServerState);

    // 1. Remove edges first (avoid dangling references)
    for (const edgeId of result.remove.edgeIds)  await put({ action: 'deleteEdge', edgeId });
    // 2. Remove nodes
    for (const nodeId of result.remove.nodeIds)  await put({ action: 'deleteNode', nodeId });
    // 3. Add new nodes + rich metadata
    for (const n of result.add.nodes) {
      await put({ action: 'addNode', node: {
        id: n.id,
        labelInitials: n.initials || n.name.slice(0, 2).toUpperCase(),
        label: n.name, nodeType: 'neural', role: n.role,
        source: 'ai-generated', position: { x: 0, y: 0 },
      }});
      await put({ action: 'updateMetadata', id: n.id, metadata: {
        name: n.name, role: n.role,
        ...(n.summary     ? { summary:     n.summary     } : {}),
        ...(n.constraints ? { constraints: n.constraints } : {}),
        ...(n.tasks       ? { tasks:       n.tasks       } : {}),
      }});
    }
    // 4. Add new edges
    for (const e of result.add.edges) {
      await put({ action: 'addEdge', edge: {
        id: e.id, source: e.source, target: e.target,
        sequence: 1, weight: 1, isCustom: true,
        ...(e.name ? { name: e.name } : {}),
      }});
    }
    // 5. Add new groups
    for (const g of result.add.groups) await put({ action: 'upsertWorkflowGroup', group: g });
    // 6. Patch existing node metadata
    for (const n of result.update.nodes) {
      const meta: Record<string, unknown> = {};
      if (n.name)        meta.name        = n.name;
      if (n.role)        meta.role        = n.role;
      if (n.summary)     meta.summary     = n.summary;
      if (n.constraints) meta.constraints = n.constraints;
      if (Object.keys(meta).length) await put({ action: 'updateMetadata', id: n.id, metadata: meta });
    }
    // 7. Extend/shrink existing groups
    for (const ext of result.update.groupExtensions) {
      const existing = fullServerState?.settings?.workflowGroups?.find(g => g.id === ext.groupId);
      if (existing) {
        const updatedNodeIds = [
          ...existing.nodeIds.filter(id => !ext.removeNodeIds.includes(id)),
          ...ext.addNodeIds.filter(id => !existing.nodeIds.includes(id)),
        ];
        await put({ action: 'upsertWorkflowGroup', group: { ...existing, nodeIds: updatedNodeIds } });
      }
    }
    // 8. Rename / recolor existing groups
    for (const g of result.update.groups ?? []) {
      const existing = fullServerState?.settings?.workflowGroups?.find(grp => grp.id === g.groupId);
      if (existing) {
        await put({ action: 'upsertWorkflowGroup', group: {
          ...existing,
          ...(g.name  ? { name:  g.name  } : {}),
          ...(g.color ? { color: g.color } : {}),
        }});
      }
    }
    // 9. Replace node task lists
    for (const nt of result.update.nodeTasks ?? []) {
      await put({ action: 'updateMetadata', id: nt.nodeId, metadata: { tasks: nt.tasks } });
    }
    // 10. Patch edge metadata (rename)
    for (const e of result.update.edges ?? []) {
      const meta: Record<string, unknown> = {};
      if (e.name)    meta.name    = e.name;
      if (e.summary) meta.summary = e.summary;
      if (Object.keys(meta).length) await put({ action: 'updateMetadata', id: e.id, metadata: meta });
    }
    // 11. Delete groups
    for (const groupId of result.remove.groupIds ?? []) await put({ action: 'deleteWorkflowGroup', groupId });
    // 12. Deselect any removed node
    if (result.remove.nodeIds.includes(selectedId ?? '')) {
      setSelectedId(null);
      setSelectedType(null);
    }

    // 13. Re-run layout: use incremental for small patches, full reset otherwise
    const addedCount   = result.add.nodes.length;
    const removedCount = result.remove.nodeIds.length;
    if (addedCount > 0 && addedCount <= 5 && removedCount === 0) {
      await put({ action: 'incrementalLayout', nodeIds: result.add.nodes.map(n => n.id) });
    } else {
      await put({ action: 'resetLayout' });
    }

    setShowAIUpdate(false);
    setAiUpdateResult(null);
  };

  const handleAddConnection = async (conn: SuggestedConnection) => {
    if (fullServerState) pushSnapshot(fullServerState);
    const edgeId = `${conn.sourceId}-${conn.targetId}-opt`;
    // improvement-only edge: hidden in Current Workflow, emerald-highlighted in Optimised Workflow
    const newEdge = {
      id: edgeId, source: conn.sourceId, target: conn.targetId,
      sequence: 1, weight: 1, isCustom: true, isImprovementOnly: true,
    };
    await put({ action: 'addEdge', edge: newEdge });

    // Process cascading automated actions (e.g. orphans)
    const orphanedIds = conn.cascadeEffects
      ?.filter(e => e.type === 'orphan' && e.id !== 'none' && !e.id.includes('effect'))
      .map(e => e.id) || [];

    orphanedIds.forEach(nodeId => {
      put({ action: 'deleteNode', nodeId });
    });

    setFullServerState(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        customNodes: (prev.customNodes ?? []).filter(n => !orphanedIds.includes(n.id)),
        customEdges: [...(prev.customEdges ?? []).filter(e => e.id !== edgeId && !orphanedIds.includes(e.source) && !orphanedIds.includes(e.target)), newEdge],
      };
    });
    // Mark as applied so canvas removes the suggested-arc highlight
    const key = `${conn.sourceId}-${conn.targetId}`;
    setAppliedConnectionKeys(prev => { const next = new Set(prev); next.add(key); return next; });
    onCanvasMutation?.();
  };

  const handleRemoveEdge = async (removal: SuggestedEdgeRemoval) => {
    if (fullServerState) pushSnapshot(fullServerState);
    await put({ action: 'deleteEdge', edgeId: removal.edgeId });
    setFullServerState(prev => prev ? {
      ...prev,
      customEdges: (prev.customEdges ?? []).filter(e => e.id !== removal.edgeId),
    } : prev);
    setAppliedEdgeRemovalIds(prev => { const next = new Set(prev); next.add(removal.edgeId); return next; });
    onCanvasMutation?.();
  };

  const resetAppliedSuggestions = () => {
    setAppliedRemovalIds(new Set());
    setAppliedConnectionKeys(new Set());
    setAppliedEdgeRemovalIds(new Set());
  };

  const handleAddNewNode = async (node: SuggestedNewNode) => {
    if (fullServerState) pushSnapshot(fullServerState);
    const nodeId = `${node.tempId}_${Date.now()}`;
    await put({ action: 'addNode', node: {
      id: nodeId,
      labelInitials: node.label.slice(0, 2).toUpperCase(),
      label: node.label,
      nodeType: 'neural',
      role: node.role as 'person' | 'tool' | 'external' | 'output',
      source: 'ai-generated',
      position: { x: 0, y: 0 },
    }});
    await put({ action: 'updateMetadata', id: nodeId, metadata: {
      name: node.label, role: node.role, summary: node.summary,
    }});
    // Wire edges
    for (const srcId of node.connectFrom) {
      await put({ action: 'addEdge', edge: {
        id: `${srcId}-${nodeId}`, source: srcId, target: nodeId,
        sequence: 1, weight: 1, isCustom: true,
      }});
    }
    for (const tgtId of node.connectTo) {
      await put({ action: 'addEdge', edge: {
        id: `${nodeId}-${tgtId}`, source: nodeId, target: tgtId,
        sequence: 1, weight: 1, isCustom: true,
      }});
    }
    // If this replaces an existing node, remove it
    if (node.replacesNodeId) {
      await put({ action: 'deleteNode', nodeId: node.replacesNodeId });
    }
    // Re-run incremental layout for the new node
    await put({ action: 'incrementalLayout', nodeIds: [nodeId] });
    setFullServerState(prev => prev ? {
      ...prev,
      customNodes: [
        ...(prev.customNodes ?? []).filter(n => n.id !== node.replacesNodeId),
        { id: nodeId, labelInitials: node.label.slice(0, 2).toUpperCase(), label: node.label, nodeType: 'neural', role: node.role as 'person' | 'tool' | 'external' | 'output', source: 'ai-generated', position: { x: 0, y: 0 } },
      ],
    } : prev);
  };

  const handleUpdateTasks = async (update: SuggestedTaskUpdate) => {
    if (fullServerState) pushSnapshot(fullServerState);

    // currentMeta is already typed as { tasks?: NodeTask[]; ... } — no cast needed
    const currentMeta  = fullServerState?.settings?.metadataOverrides?.[update.nodeId];
    const currentTasks = currentMeta?.tasks ?? [];

    // Remove specified task IDs, then append new ones
    const remaining = currentTasks.filter(t => !update.removeTasks.includes(t.id));

    // Coerce addTasks status/priority strings to the NodeTask union literals so
    // the merged array satisfies NodeTask[] without `as any`.
    const VALID_STATUS   = ['todo','in-progress','done','blocked','review'] as const;
    const VALID_PRIORITY = ['low','medium','high'] as const;
    type S = typeof VALID_STATUS[number];
    type P = typeof VALID_PRIORITY[number];

    const coerced = update.addTasks.map(t => ({
      id:       t.id,
      title:    t.title,
      status:   (VALID_STATUS.includes(t.status as S)     ? t.status   : 'todo')   as S,
      priority: (VALID_PRIORITY.includes(t.priority as P) ? t.priority : 'medium') as P,
    }));

    const merged = [...remaining, ...coerced];

    await put({ action: 'updateMetadata', id: update.nodeId, metadata: { tasks: merged } });
    setFullServerState(prev => {
      if (!prev) return prev;
      const overrides = { ...(prev.settings?.metadataOverrides ?? {}) };
      overrides[update.nodeId] = { ...(overrides[update.nodeId] ?? {}), tasks: merged };
      return { ...prev, settings: { ...prev.settings!, metadataOverrides: overrides } };
    });
  };

  const handleRemoveEntity = async (removal: SuggestedRemoval) => {
    if (removal.type !== 'node') return;
    if (fullServerState) pushSnapshot(fullServerState);

    if (removal.action === 'merge' && removal.mergeTargetId) {
      // Re-route all custom edges from the removed node to the merge target
      const edgesToReroute = (fullServerState?.customEdges ?? []).filter(
        e => e.source === removal.id || e.target === removal.id
      );
      for (const edge of edgesToReroute) {
        await put({ action: 'deleteEdge', edgeId: edge.id });
        const newSource = edge.source === removal.id ? removal.mergeTargetId! : edge.source;
        const newTarget = edge.target === removal.id ? removal.mergeTargetId! : edge.target;
        // Skip self-loops created by the merge
        if (newSource !== newTarget) {
          await put({ action: 'addEdge', edge: {
            id: `${newSource}-${newTarget}-merged`,
            source: newSource, target: newTarget,
            sequence: 1, weight: 1, isCustom: true,
          }});
        }
      }
      await put({ action: 'deleteNode', nodeId: removal.id });
      setFullServerState(prev => prev ? {
        ...prev,
        customNodes: (prev.customNodes ?? []).filter(n => n.id !== removal.id),
        customEdges: [
          ...(prev.customEdges ?? []).filter(
            e => e.source !== removal.id && e.target !== removal.id
          ),
          ...edgesToReroute
            .map(edge => {
              const newSource = edge.source === removal.id ? removal.mergeTargetId! : edge.source;
              const newTarget = edge.target === removal.id ? removal.mergeTargetId! : edge.target;
              if (newSource === newTarget) return null;
              return { ...edge, id: `${newSource}-${newTarget}-merged`, source: newSource, target: newTarget };
            })
            .filter((e): e is NonNullable<typeof e> => e !== null),
        ],
      } : prev);

    } else if (removal.action === 'automate') {
      // Create a replacement tool node then remove the original
      const toolNodeId = `${removal.id}_auto_${Date.now()}`;
      const toolLabel  = `${removal.name} (Auto)`;
      await put({ action: 'addNode', node: {
        id: toolNodeId,
        labelInitials: '⚙',
        label: toolLabel,
        nodeType: 'neural',
        role: 'tool',
        source: 'ai-generated',
        position: { x: 0, y: 0 },
      }});
      await put({ action: 'updateMetadata', id: toolNodeId, metadata: {
        name: toolLabel,
        role: 'tool',
        summary: `Automated replacement for ${removal.name}. ${removal.reason}`,
      }});
      // Re-route custom edges from original node to the new tool node
      const edgesToReroute = (fullServerState?.customEdges ?? []).filter(
        e => e.source === removal.id || e.target === removal.id
      );
      for (const edge of edgesToReroute) {
        await put({ action: 'deleteEdge', edgeId: edge.id });
        const newSource = edge.source === removal.id ? toolNodeId : edge.source;
        const newTarget = edge.target === removal.id ? toolNodeId : edge.target;
        await put({ action: 'addEdge', edge: {
          id: `${newSource}-${newTarget}`,
          source: newSource, target: newTarget,
          sequence: 1, weight: 1, isCustom: true,
        }});
      }
      await put({ action: 'deleteNode', nodeId: removal.id });
      await put({ action: 'incrementalLayout', nodeIds: [toolNodeId] });
      setFullServerState(prev => prev ? {
        ...prev,
        customNodes: [
          ...(prev.customNodes ?? []).filter(n => n.id !== removal.id),
          { id: toolNodeId, labelInitials: '⚙', label: toolLabel, nodeType: 'neural' as const, role: 'tool' as const, source: 'ai-generated' as const, position: { x: 0, y: 0 } },
        ],
        customEdges: [
          ...(prev.customEdges ?? []).filter(e => e.source !== removal.id && e.target !== removal.id),
          ...edgesToReroute.map(edge => ({
            ...edge,
            id: `${edge.source === removal.id ? toolNodeId : edge.source}-${edge.target === removal.id ? toolNodeId : edge.target}`,
            source: edge.source === removal.id ? toolNodeId : edge.source,
            target: edge.target === removal.id ? toolNodeId : edge.target,
          })),
        ],
      } : prev);

    } else {
      // Default: remove entirely
      put({ action: 'deleteNode', nodeId: removal.id });
      setFullServerState(prev => prev ? {
        ...prev,
        customNodes: (prev.customNodes ?? []).filter(n => n.id !== removal.id),
        customEdges: (prev.customEdges ?? []).filter(e => e.source !== removal.id && e.target !== removal.id),
      } : prev);
    }

    if (selectedId === removal.id) { setSelectedId(null); setSelectedType(null); }
    setAppliedRemovalIds(prev => { const next = new Set(prev); next.add(removal.id); return next; });
  };

  const handleApplyGroupUpdate = (upd: SuggestedGroupUpdate) => {
    if (fullServerState) pushSnapshot(fullServerState);

    if (upd.action === 'create') {
      const groupId = `group-ai-${Date.now()}`;
      const newGroup = {
        id:      groupId,
        name:    upd.name ?? 'AI Group',
        color:   upd.color ?? '#6366F1',
        nodeIds: upd.nodeIds ?? [],
      };
      put({ action: 'upsertWorkflowGroup', group: newGroup });
      setFullServerState(prev => prev ? {
        ...prev,
        settings: {
          ...prev.settings!,
          workflowGroups: [...(prev.settings?.workflowGroups ?? []), newGroup],
        },
      } : prev);

    } else if (upd.action === 'update' && upd.groupId) {
      const existing = fullServerState?.settings?.workflowGroups?.find(g => g.id === upd.groupId);
      if (!existing) return;
      const updatedNodeIds = [
        ...(existing.nodeIds ?? []).filter(id => !(upd.removeNodeIds ?? []).includes(id)),
        ...(upd.addNodeIds ?? []).filter(id => !(existing.nodeIds ?? []).includes(id)),
      ];
      const updated = {
        ...existing,
        ...(upd.name  ? { name:    upd.name  } : {}),
        ...(upd.color ? { color:   upd.color } : {}),
        nodeIds: upd.nodeIds !== undefined ? upd.nodeIds : updatedNodeIds,
      };
      put({ action: 'upsertWorkflowGroup', group: updated });
      setFullServerState(prev => prev ? {
        ...prev,
        settings: {
          ...prev.settings!,
          workflowGroups: (prev.settings?.workflowGroups ?? []).map(g =>
            g.id === upd.groupId ? updated : g
          ),
        },
      } : prev);

    } else if (upd.action === 'delete' && upd.groupId) {
      put({ action: 'deleteWorkflowGroup', groupId: upd.groupId });
      setFullServerState(prev => prev ? {
        ...prev,
        settings: {
          ...prev.settings!,
          workflowGroups: (prev.settings?.workflowGroups ?? []).filter(g => g.id !== upd.groupId),
        },
      } : prev);
    }
  };

  return {
    // config
    aiConfig, handleSaveAiConfig, activeApiKey,
    // modal visibility
    showAISettings, setShowAISettings,
    showAIAnalysis, setShowAIAnalysis,
    showAIUpdate,   setShowAIUpdate,
    showDebugLog,   setShowDebugLog,
    // analyze
    aiAnalysis, aiAnalysisLoading, aiAnalysisError,
    aiSuggestedConnections, aiSuggestedRemovals,
    aiAnalysisTimestamp,
    handleAiAnalyze, handleReAnalyze,
    // update
    aiUpdateLoading, aiUpdateResult, aiUpdateError,
    handleAiUpdate, handleApplyUpdate, setAiUpdateResult, setAiUpdateError,
    // analysis actions
    handleAddConnection, handleRemoveEntity,
    appliedRemovalIds, appliedConnectionKeys, appliedEdgeRemovalIds,
    resetAppliedSuggestions,
    // new suggestion types
    aiSuggestedEdgeRemovals, aiSuggestedNewNodes, aiSuggestedTaskUpdates, aiSuggestedGroupUpdates, aiSuggestionPlan,
    // handlers
    handleRemoveEdge, handleAddNewNode, handleUpdateTasks, handleApplyGroupUpdate,
    // debug
    aiDebugLog, setAiDebugLog,
  };
}
