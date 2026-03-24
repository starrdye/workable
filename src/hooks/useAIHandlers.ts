// src/hooks/useAIHandlers.ts
// All AI-related state and handlers: settings, analyze, update, apply, debug log.
// Receives shared state as parameters so mutations propagate back to the page.
// Track 8b

import { useState, useEffect } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { loadAIConfig, type AIConfig, AI_CONFIG_KEY } from '@/components/AISettingsModal';
import { PROVIDERS, type AIProvider } from '@/lib/aiClient';
import type { ServerGraphState } from '@/lib/serverState';
import type { SuggestedConnection, SuggestedRemoval } from '@/components/AIAnalysisModal';
import type { AIUpdateResult } from '@/components/AIUpdateModal';
import type { AIDebugLog } from '@/components/StartScreen';

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

  // ── AI Update state ────────────────────────────────────────────────────────
  const [aiUpdateLoading, setAiUpdateLoading] = useState(false);
  const [aiUpdateResult,  setAiUpdateResult]  = useState<AIUpdateResult | null>(null);
  const [aiUpdateError,   setAiUpdateError]   = useState<string | null>(null);

  // ── Debug log ──────────────────────────────────────────────────────────────
  const [aiDebugLog, setAiDebugLog] = useState<AIDebugLog | null>(null);

  // ── Handlers ──────────────────────────────────────────────────────────────

  // Core fetch — called by both handleAiAnalyze (first time) and handleReAnalyze
  const runAnalyze = async () => {
    setAiAnalysisError(null);
    setAiAnalysisLoading(true);
    try {
      const res = await fetch('/api/ai/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflowData: fullServerState,
          apiKey:   activeApiKey,
          provider: aiConfig.provider,
          model:    aiConfig.models[aiConfig.provider],
          baseUrl:  aiConfig.baseUrls?.[aiConfig.provider] || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAiAnalysisError(data.error ?? 'Analysis failed.');
      } else {
        setAiAnalysis(data.analysis);
        setAiSuggestedConnections(data.suggestedConnections ?? []);
        setAiSuggestedRemovals(data.suggestedRemovals ?? []);
        setAiAnalysisTimestamp(Date.now());
      }
    } catch {
      setAiAnalysisError('Network error. Please try again.');
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

  // Re-run fresh analysis, clearing the previous result
  const handleReAnalyze = async () => {
    setAiAnalysis(null);
    setAiSuggestedConnections([]);
    setAiSuggestedRemovals([]);
    setAiAnalysisTimestamp(null);
    await runAnalyze();
  };

  const handleAiUpdate = async (prompt: string) => {
    if (!activeApiKey) { setShowAISettings(true); return; }
    setAiUpdateResult(null);
    setAiUpdateError(null);
    setAiUpdateLoading(true);
    try {
      const res = await fetch('/api/ai/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          currentState: fullServerState,
          apiKey:   activeApiKey,
          provider: aiConfig.provider,
          model:    aiConfig.models[aiConfig.provider],
          baseUrl:  aiConfig.baseUrls?.[aiConfig.provider] || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAiUpdateError(data.error ?? 'Update failed.');
      } else {
        setAiUpdateResult(data as AIUpdateResult);
      }
    } catch {
      setAiUpdateError('Network error. Please try again.');
    } finally {
      setAiUpdateLoading(false);
    }
  };

  const handleApplyUpdate = async (result: AIUpdateResult) => {
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

  const handleAddConnection = (conn: SuggestedConnection) => {
    const edgeId = `${conn.sourceId}-${conn.targetId}-opt`;
    // Added from analysis = permanent edge, always visible (not improvement-only)
    const newEdge = {
      id: edgeId, source: conn.sourceId, target: conn.targetId,
      sequence: 1, weight: 1, isCustom: true, isImprovementOnly: false,
    };
    put({ action: 'addEdge', edge: newEdge });
    setFullServerState(prev => prev ? {
      ...prev,
      customEdges: [...(prev.customEdges ?? []).filter(e => e.id !== edgeId), newEdge],
    } : prev);
  };

  const handleRemoveEntity = (removal: SuggestedRemoval) => {
    if (removal.type === 'node') {
      put({ action: 'deleteNode', nodeId: removal.id });
      setFullServerState(prev => prev ? {
        ...prev,
        customNodes: (prev.customNodes ?? []).filter(n => n.id !== removal.id),
        customEdges: (prev.customEdges ?? []).filter(e => e.source !== removal.id && e.target !== removal.id),
      } : prev);
      if (selectedId === removal.id) { setSelectedId(null); setSelectedType(null); }
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
    // debug
    aiDebugLog, setAiDebugLog,
  };
}
