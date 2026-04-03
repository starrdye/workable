// src/hooks/useAIHandlers.ts
// All AI-related state and handlers: settings, analyze, update, apply, debug log.
// Receives shared state as parameters so mutations propagate back to the page.
// Track 8b  — vb0.2: delegates to useAIEngine for mode-aware routing.
// Track 14d — vb0.21: runAnalyze uses streaming SSE so analysis text appears live.

import { useState, useEffect, useRef } from 'react';
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
  language: string,
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
  /** Track 14d: partial text accumulated as SSE chunks arrive — shown live in modal */
  const [aiAnalysisStreamText,  setAiAnalysisStreamText]  = useState<string>('');
  const [aiSuggestedConnections,setAiSuggestedConnections] = useState<SuggestedConnection[]>([]);
  const [aiSuggestedRemovals,   setAiSuggestedRemovals]   = useState<SuggestedRemoval[]>([]);
  const [aiAnalysisTimestamp,   setAiAnalysisTimestamp]   = useState<number | null>(null);
  const [aiSuggestedEdgeRemovals,  setAiSuggestedEdgeRemovals]  = useState<SuggestedEdgeRemoval[]>([]);
  const [aiSuggestedNewNodes,      setAiSuggestedNewNodes]      = useState<SuggestedNewNode[]>([]);
  const [aiSuggestedTaskUpdates,   setAiSuggestedTaskUpdates]   = useState<SuggestedTaskUpdate[]>([]);
  const [aiSuggestionPlan,         setAiSuggestionPlan]         = useState<{ phases: SuggestionPhase[] } | null>(null);
  const [aiSuggestedGroupUpdates,  setAiSuggestedGroupUpdates]  = useState<SuggestedGroupUpdate[]>([]);
  const [aiAnalysisIsDemo,      setAiAnalysisIsDemo]      = useState(false);

  // Track which suggestions have already been applied so canvas can remove highlights
  const [appliedRemovalIds,     setAppliedRemovalIds]     = useState<Set<string>>(() => new Set());
  const [appliedConnectionKeys, setAppliedConnectionKeys] = useState<Set<string>>(() => new Set());
  const [appliedEdgeRemovalIds, setAppliedEdgeRemovalIds] = useState<Set<string>>(() => new Set());
  /** Track IDs of suggested new nodes (tempId) that have been successfully applied */
  const [appliedNewNodeIds,     setAppliedNewNodeIds]     = useState<Set<string>>(() => new Set());
  /** Track nodeIds of applied task updates — used to show "applied" badge in modal */
  const [appliedTaskNodeIds,    setAppliedTaskNodeIds]    = useState<Set<string>>(() => new Set());
  /**
   * vb0.22: IDs of workflow groups that were created by an AI "create group"
   * suggestion — used by GraphCanvas to render them with a distinct proposed-group
   * visual (dashed emerald border + pulse) so they stand out from manually-created groups.
   */
  const [appliedAIGroupIds, setAppliedAIGroupIds] = useState<Set<string>>(() => new Set());

  // Ref guard: ensures demo auto-apply only runs once per analysis session
  const demoAutoApplied = useRef(false);

  // ── AI Update state ────────────────────────────────────────────────────────
  const [aiUpdateLoading, setAiUpdateLoading] = useState(false);
  const [aiUpdateResult,  setAiUpdateResult]  = useState<AIUpdateResult | null>(null);
  const [aiUpdateError,   setAiUpdateError]   = useState<string | null>(null);

  // ── Debug log ──────────────────────────────────────────────────────────────
  const [aiDebugLog, setAiDebugLog] = useState<AIDebugLog | null>(null);

  // ── AI Engine (vb0.2: mode-aware routing with abort handling) ─────────────
  const aiEngine = useAIEngine();

  // ── Handlers ──────────────────────────────────────────────────────────────

  // Core fetch — called by both handleAiAnalyze (first time) and handleReAnalyze.
  // Track 14d: Uses SSE streaming so analysis text appears progressively in the modal.
  // Falls back to buffered if the distributed engine is active (it doesn't stream).
  const runAnalyze = async () => {
    setAiAnalysisError(null);
    setAiAnalysisLoading(true);
    setAiAnalysisStreamText('');

    const isDemo = fullServerState?.settings?.templateId === 'demo-jack';

    const config = {
      apiKey:   isDemo ? 'demo-mock-key' : activeApiKey,
      provider: isDemo ? 'demo' as AIProvider : aiConfig.provider,
      model:    isDemo ? 'demo-model' : aiConfig.models[aiConfig.provider],
      baseUrl:  aiConfig.baseUrls?.[aiConfig.provider],
      lang:     language,
    };

    // Distributed engine doesn't support streaming — use buffered path
    if (aiEngine.mode === 'distributed') {
      try {
        const { data, aborted, engine } = await aiEngine.runAnalyze(fullServerState, config);
        if (aborted) { setAiAnalysisLoading(false); return; }
        applyAnalysisData(data, engine);
      } catch (err) {
        setAiAnalysisError(err instanceof Error ? err.message : 'Network error. Please try again.');
      } finally {
        setAiAnalysisLoading(false);
      }
      return;
    }

    // Monolithic engine — streaming path
    try {
      const { aborted } = await aiEngine.runAnalyzeStream(
        fullServerState,
        config,
        {
          onChunk: (chunk) => {
            setAiAnalysisStreamText(prev => prev + chunk);
          },
          onDone: (data) => {
            setAiAnalysisStreamText('');
            applyAnalysisData(data, 'monolithic');
            setAiAnalysisLoading(false);
          },
          onError: (message) => {
            setAiAnalysisError(message);
            setAiAnalysisLoading(false);
          },
        },
      );
      if (aborted) setAiAnalysisLoading(false);
    } catch (err) {
      setAiAnalysisError(err instanceof Error ? err.message : 'Network error. Please try again.');
      setAiAnalysisLoading(false);
    }
  };

  /** Apply a completed analysis result (shared by streaming onDone + buffered path) */
  const applyAnalysisData = (data: Record<string, unknown>, engine: 'monolithic' | 'distributed') => {
    setAiAnalysis(data.analysis as string);
    setAiAnalysisIsDemo(!!data.isDemo);
    setAiSuggestedConnections((data.suggestedConnections ?? []) as SuggestedConnection[]);
    setAiSuggestedRemovals((data.suggestedRemovals ?? []) as SuggestedRemoval[]);
    setAiSuggestedEdgeRemovals((data.suggestedEdgeRemovals ?? []) as SuggestedEdgeRemoval[]);
    setAiSuggestedNewNodes((data.suggestedNewNodes ?? []) as SuggestedNewNode[]);
    setAiSuggestedTaskUpdates((data.suggestedTaskUpdates ?? []) as SuggestedTaskUpdate[]);
    setAiSuggestedGroupUpdates((data.suggestedGroupUpdates ?? []) as SuggestedGroupUpdate[]);
    setAiSuggestionPlan((data.suggestionPlan ?? null) as { phases: SuggestionPhase[] } | null);
    setAiAnalysisTimestamp(Date.now());
    setAiDebugLog({
      prompt: `[AI Analyze — ${engine} engine]`,
      rawAIResponse: typeof data.analysis === 'string' ? data.analysis : JSON.stringify(data, null, 2),
      engine,
      tokenUsage: (data.tokenUsage as { inputTokens: number; outputTokens: number } | null) ?? null,
    });
  };

  // Opens the modal; only auto-fetches when no cached result exists
  const handleAiAnalyze = async () => {
    const isDemo = fullServerState?.settings?.templateId === 'demo-jack';
    if (!isDemo && !activeApiKey) { setShowAISettings(true); return; }
    setShowAIAnalysis(true);
    if (!aiAnalysis && !aiAnalysisError && !aiAnalysisLoading) {
      await runAnalyze();
    }
  };

  // Clear all analysis state without re-running (e.g. when a new workflow/template is loaded)
  const resetAnalysis = () => {
    setAiAnalysis(null);
    setAiAnalysisIsDemo(false);
    setAiAnalysisError(null);
    setAiSuggestedConnections([]);
    setAiSuggestedRemovals([]);
    setAiAnalysisTimestamp(null);
    setAppliedRemovalIds(new Set());
    setAppliedConnectionKeys(new Set());
    setAppliedEdgeRemovalIds(new Set());
    setAppliedNewNodeIds(new Set());
    setAppliedAIGroupIds(new Set());
    setAiSuggestedEdgeRemovals([]);
    setAiSuggestedNewNodes([]);
    setAiSuggestedTaskUpdates([]);
    setAiSuggestedGroupUpdates([]);
    setAiSuggestionPlan(null);
    demoAutoApplied.current = false;
  };

  // Demo mode: once analysis loads, auto-apply suggested new nodes as improvement-only additions
  useEffect(() => {
    if (!aiAnalysisIsDemo || demoAutoApplied.current || aiSuggestedNewNodes.length === 0) return;
    demoAutoApplied.current = true;

    const newEdges = aiSuggestedNewNodes.flatMap(node => [
      ...node.connectFrom.map(srcId => ({
        id: `${srcId}-${node.tempId}-demo`, source: srcId, target: node.tempId,
        sequence: 1, weight: 1, isCustom: true, isImprovementOnly: true,
      })),
      ...node.connectTo.map(tgtId => ({
        id: `${node.tempId}-${tgtId}-demo`, source: node.tempId, target: tgtId,
        sequence: 1, weight: 1, isCustom: true, isImprovementOnly: true,
      })),
    ]);

    const newNodes = aiSuggestedNewNodes.map(node => ({
        id: node.tempId,
        labelInitials: node.label.slice(0, 2).toUpperCase(),
        label: node.label,
        nodeType: 'neural' as const,
        role: node.role as 'person' | 'tool' | 'external' | 'output',
        source: 'ai-generated' as const,
        position: { x: 0, y: 0 } as { x: number; y: number },
    }));

    (async () => {
      for (const node of newNodes) {
        await put({ action: 'addNode', node });
        const summary = aiSuggestedNewNodes.find(n => n.tempId === node.id)?.summary;
        await put({ action: 'updateMetadata', id: node.id, metadata: { name: node.label, role: node.role, summary: summary } });
      }
      for (const edge of newEdges) {
        await put({ action: 'addEdge', edge });
      }
      await put({ action: 'incrementalLayout', nodeIds: newNodes.map(n => n.id) });
      onCanvasMutation?.();
    })();

    // Optimistic local state update
    setFullServerState(prev => {
      if (!prev) return prev;
      const newNodes = aiSuggestedNewNodes.map(node => ({
        id: node.tempId,
        labelInitials: node.label.slice(0, 2).toUpperCase(),
        label: node.label,
        nodeType: 'neural' as const,
        role: node.role as 'person' | 'tool' | 'external' | 'output',
        source: 'ai-generated' as const,
        position: { x: 0, y: 0 } as { x: number; y: number },
      }));
      const newEdges = aiSuggestedNewNodes.flatMap(node => [
        ...node.connectFrom.map(srcId => ({
          id: `${srcId}-${node.tempId}-demo`, source: srcId, target: node.tempId,
          sequence: 1, weight: 1, isCustom: true, isImprovementOnly: true,
        })),
        ...node.connectTo.map(tgtId => ({
          id: `${node.tempId}-${tgtId}-demo`, source: node.tempId, target: tgtId,
          sequence: 1, weight: 1, isCustom: true, isImprovementOnly: true,
        })),
      ]);
      return {
        ...prev,
        customNodes: [
          ...(prev.customNodes ?? []).filter(n => !newNodes.find(nn => nn.id === n.id)),
          ...newNodes,
        ],
        customEdges: [
          ...(prev.customEdges ?? []).filter(e => !newEdges.find(ne => ne.id === e.id)),
          ...newEdges,
        ],
      };
    });

    // Server layout is already triggered sequentially above; UI will catch up
    setTimeout(() => {
      onCanvasMutation?.();
    }, 300);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiAnalysisIsDemo, aiSuggestedNewNodes.length]);

  // Re-run fresh analysis, clearing the previous result and applied tracking
  const handleReAnalyze = async () => {
    resetAnalysis();
    await runAnalyze();
  };

  const handleAiUpdate = async (prompt: string) => {
    const isDemo = fullServerState?.settings?.templateId === 'demo-jack';
    if (!isDemo && !activeApiKey) { setShowAISettings(true); return; }
    setAiUpdateResult(null);
    setAiUpdateError(null);
    setAiUpdateLoading(true);
    try {
      const updateConfig = isDemo
        ? { apiKey: 'demo', provider: 'demo' as AIProvider, model: 'demo-mock', baseUrl: undefined, lang: language }
        : { apiKey: activeApiKey, provider: aiConfig.provider, model: aiConfig.models[aiConfig.provider], baseUrl: aiConfig.baseUrls?.[aiConfig.provider], lang: language };
      const { data, aborted, engine } = await aiEngine.runUpdate(
        prompt,
        fullServerState,
        updateConfig,
      );

      // If aborted (mode toggled mid-flight), silently discard
      if (aborted) {
        setAiUpdateLoading(false);
        return;
      }

      setAiUpdateResult(data as unknown as AIUpdateResult);
      setAiDebugLog({
        prompt: `[AI Update — ${engine} engine] ${prompt}`,
        rawAIResponse: JSON.stringify(data, null, 2),
        engine,
        tokenUsage: (data.tokenUsage as { inputTokens: number; outputTokens: number } | null) ?? null,
      });
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

    // vb0.23: Optimistic state update for bulk removal cases in handleApplyUpdate
    setFullServerState(prev => {
      if (!prev || result.remove.nodeIds.length === 0) return prev;
      const newBaseline = { ...(prev.baselinePositions ?? {}) };
      const newEcosystem = { ...(prev.ecosystemPositions ?? {}) };
      result.remove.nodeIds.forEach(id => {
        delete newBaseline[id];
        delete newEcosystem[id];
      });
      return {
        ...prev,
        baselinePositions: newBaseline,
        ecosystemPositions: newEcosystem,
        // (Other fields are updated by the subsequent fetch/poll, but prune positions now to avoid ghosts)
      };
    });
  };

  const handleAddConnection = async (conn: SuggestedConnection) => {
    if (fullServerState) pushSnapshot(fullServerState);
    const edgeId = `${conn.sourceId}-${conn.targetId}-opt`;
    // Applied edge becomes a permanent normal edge — visible in both Current and Optimised views,
    // with no special colouring. The "proposed" dashed-arc overlay is removed by adding the key
    // to appliedConnectionKeys; the edge itself is a regular custom edge from this point on.
    const newEdge = {
      id: edgeId, source: conn.sourceId, target: conn.targetId,
      sequence: 1, weight: 1, isCustom: true,
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
      const newBaseline = { ...(prev.baselinePositions ?? {}) };
      const newEcosystem = { ...(prev.ecosystemPositions ?? {}) };
      orphanedIds.forEach(id => {
        delete newBaseline[id];
        delete newEcosystem[id];
      });
      return {
        ...prev,
        baselinePositions: newBaseline,
        ecosystemPositions: newEcosystem,
        customNodes: (prev.customNodes ?? []).filter(n => !orphanedIds.includes(n.id)),
        customEdges: [...(prev.customEdges ?? []).filter(e => e.id !== edgeId && !orphanedIds.includes(e.source) && !orphanedIds.includes(e.target)), newEdge],
      };
    });
    // Mark as applied so canvas removes the suggested-arc highlight
    const key = `${conn.sourceId}-${conn.targetId}`;
    setAppliedConnectionKeys(prev => { const next = new Set(prev); next.add(key); return next; });

    // vb0.24: If this connection targets a suggested new node, mark it applied
    const targetNodeSuggestion = aiSuggestedNewNodes.find(sn => sn.tempId === conn.targetId);
    if (targetNodeSuggestion) {
      setAppliedNewNodeIds(prev => { const next = new Set(prev); next.add(targetNodeSuggestion.tempId); return next; });
    }

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

  /**
   * After an undo/redo, reconcile applied-suggestion sets against the restored state.
   * Only marks a suggestion as still-applied if the change it made is still present,
   * so buttons re-enable automatically when their action was actually undone.
   */
  const reconcileAfterUndo = (newState: ServerGraphState | null) => {
    if (!newState) {
      // No state available — full reset
      setAppliedRemovalIds(new Set());
      setAppliedConnectionKeys(new Set());
      setAppliedEdgeRemovalIds(new Set());
      setAppliedNewNodeIds(new Set());
      setAppliedTaskNodeIds(new Set());
      setAppliedAIGroupIds(new Set());
      return;
    }

    const customEdgeIds = new Set((newState.customEdges ?? []).map(e => e.id));
    const customNodeIds = new Set((newState.customNodes ?? []).map(n => n.id));
    const groupIds      = new Set((newState.settings?.workflowGroups ?? []).map(g => g.id));
    const presentNodeIds = new Set([
      ...Object.keys(newState.baselinePositions  ?? {}),
      ...Object.keys(newState.ecosystemPositions ?? {}),
      ...(newState.customNodes ?? []).map(n => n.id),
    ]);

    // Add-connection: keep key only if the "-opt" edge still exists in customEdges
    setAppliedConnectionKeys(prev => {
      const next = new Set<string>();
      for (const key of prev) {
        if (customEdgeIds.has(`${key}-opt`)) next.add(key);
      }
      return next;
    });

    // Add-new-node: keep tempId only if a customNode with that prefix still exists
    setAppliedNewNodeIds(prev => {
      const next = new Set<string>();
      for (const tempId of prev) {
        const stillPresent = Array.from(customNodeIds).some(id => id.startsWith(`${tempId}_`));
        if (stillPresent) next.add(tempId);
      }
      return next;
    });

    // Group update: keep groupId only if the group still exists
    setAppliedAIGroupIds(prev => {
      const next = new Set<string>();
      for (const gid of prev) {
        if (groupIds.has(gid)) next.add(gid);
      }
      return next;
    });

    // Remove-node: keep id only if the node is STILL absent from the state
    setAppliedRemovalIds(prev => {
      const next = new Set<string>();
      for (const nodeId of prev) {
        if (!presentNodeIds.has(nodeId)) next.add(nodeId);
      }
      return next;
    });

    // Remove-edge: keep edgeId only if the edge is still absent from customEdges
    setAppliedEdgeRemovalIds(prev => {
      const next = new Set<string>();
      for (const edgeId of prev) {
        if (!customEdgeIds.has(edgeId)) next.add(edgeId); // Still absent → still applied
      }
      return next;
    });

    // Task update: keep nodeId only if the node still exists in the state
    setAppliedTaskNodeIds(prev => {
      const next = new Set<string>();
      for (const nodeId of prev) {
        if (presentNodeIds.has(nodeId)) next.add(nodeId);
      }
      return next;
    });
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
    setAppliedNewNodeIds(prev => { const next = new Set(prev); next.add(node.tempId); return next; });
    setFullServerState(prev => {
      if (!prev) return prev;
      const newBaseline = { ...(prev.baselinePositions ?? {}) };
      const newEcosystem = { ...(prev.ecosystemPositions ?? {}) };
      if (node.replacesNodeId) {
        delete newBaseline[node.replacesNodeId];
        delete newEcosystem[node.replacesNodeId];
      }
      return {
        ...prev,
        baselinePositions: newBaseline,
        ecosystemPositions: newEcosystem,
        customNodes: [
          ...(prev.customNodes ?? []).filter(n => n.id !== node.replacesNodeId),
          { id: nodeId, labelInitials: node.label.slice(0, 2).toUpperCase(), label: node.label, nodeType: 'neural', role: node.role as 'person' | 'tool' | 'external' | 'output', source: 'ai-generated', position: { x: 0, y: 0 } },
        ],
      };
    });
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
    setAppliedTaskNodeIds(prev => { const next = new Set(prev); next.add(update.nodeId); return next; });
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
      setFullServerState(prev => {
        if (!prev) return prev;
        const newBaseline = { ...(prev.baselinePositions ?? {}) };
        const newEcosystem = { ...(prev.ecosystemPositions ?? {}) };
        delete newBaseline[removal.id];
        delete newEcosystem[removal.id];
        return {
          ...prev,
          baselinePositions: newBaseline,
          ecosystemPositions: newEcosystem,
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
        };
      });

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
      setFullServerState(prev => {
        if (!prev) return prev;
        const newBaseline = { ...(prev.baselinePositions ?? {}) };
        const newEcosystem = { ...(prev.ecosystemPositions ?? {}) };
        delete newBaseline[removal.id];
        delete newEcosystem[removal.id];
        return {
          ...prev,
          baselinePositions: newBaseline,
          ecosystemPositions: newEcosystem,
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
        };
      });

    } else {
      // Default: remove entirely
      put({ action: 'deleteNode', nodeId: removal.id });
    setFullServerState(prev => {
      if (!prev) return prev;
      const newNodes = (prev.customNodes ?? []).filter(n => n.id !== removal.id);
      const newEdges = (prev.customEdges ?? []).filter(e => e.source !== removal.id && e.target !== removal.id);
      const newBaseline = { ...(prev.baselinePositions ?? {}) };
      const newEcosystem = { ...(prev.ecosystemPositions ?? {}) };
      delete newBaseline[removal.id];
      delete newEcosystem[removal.id];

      return {
        ...prev,
        customNodes: newNodes,
        customEdges: newEdges,
        baselinePositions: newBaseline,
        ecosystemPositions: newEcosystem,
      };
    });
  }

    if (selectedId === removal.id) { setSelectedId(null); setSelectedType(null); }
    setAppliedRemovalIds(prev => { const next = new Set(prev); next.add(removal.id); return next; });

    // vb0.24: If automation creates a replacement that matches a suggested new node, mark it as applied
    if (removal.action === 'automate') {
      const match = aiSuggestedNewNodes.find(sn => 
        sn.replacesNodeId === removal.id || sn.label.toLowerCase() === removal.name.toLowerCase()
      );
      if (match) setAppliedNewNodeIds(prev => { const next = new Set(prev); next.add(match.tempId); return next; });
    }
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
      setAppliedAIGroupIds(prev => { const next = new Set(prev); next.add(groupId); return next; });
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
    aiAnalysis, aiAnalysisLoading, aiAnalysisError, aiAnalysisStreamText, aiAnalysisIsDemo,
    aiSuggestedConnections, aiSuggestedRemovals,
    aiAnalysisTimestamp,
    handleAiAnalyze, handleReAnalyze, resetAnalysis,
    // update
    aiUpdateLoading, aiUpdateResult, aiUpdateError,
    handleAiUpdate, handleApplyUpdate, setAiUpdateResult, setAiUpdateError,
    // analysis actions
    handleAddConnection, handleRemoveEntity,
    appliedRemovalIds, appliedConnectionKeys, appliedEdgeRemovalIds, appliedNewNodeIds,
    appliedTaskNodeIds, appliedAIGroupIds,
    reconcileAfterUndo,
    // new suggestion types
    aiSuggestedEdgeRemovals, aiSuggestedNewNodes, aiSuggestedTaskUpdates, aiSuggestedGroupUpdates, aiSuggestionPlan,
    // handlers
    handleRemoveEdge, handleAddNewNode, handleUpdateTasks, handleApplyGroupUpdate,
    // debug
    aiDebugLog, setAiDebugLog,
  };
}
