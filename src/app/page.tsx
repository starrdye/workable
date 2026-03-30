"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { StartScreen, type AIParsedResult, type AIDebugLog } from "@/components/StartScreen";
import { GraphCanvas, GraphCanvasRef } from "@/components/GraphCanvas";
import { AnalysisSidebar, AnalysisData } from "@/components/AnalysisSidebar";
import { AISettingsModal } from "@/components/AISettingsModal";
import { AIAnalysisModal } from "@/components/AIAnalysisModal";
import { AIUpdateModal } from "@/components/AIUpdateModal";
import { KeyboardHelpModal } from "@/components/KeyboardHelpModal";
import {
  Zap, Download, FileText, Upload, Settings, Sparkles, ChevronLeft,
  LayoutGrid, Search, X, ChevronDown, ChevronRight, Plus, Trash2, Pencil, GitMerge,
  Undo2, Redo2, BookOpen, Keyboard, Clock,
} from "lucide-react";
import { PROVIDERS } from "@/lib/aiClient";

// ── Custom hooks (Track 8b) ────────────────────────────────────────────────────
import { useGraphState }        from "@/hooks/useGraphState";
import { useCanvasFilters }     from "@/hooks/useCanvasFilters";
import { useWorkflowGroups }    from "@/hooks/useWorkflowGroups";
import { useAIHandlers }        from "@/hooks/useAIHandlers";
import { useUndoRedo }          from "@/hooks/useUndoRedo";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useWorkflowLibrary }   from "@/hooks/useWorkflowLibrary";
import { AIEngineToggle }       from "@/components/AIEngineToggle";
import { WorkflowGeneratingOverlay, SkeletonCanvas } from "@/components/WorkflowGeneratingOverlay";

const ROLE_CHIPS = [
  { id: "person",   label: "Person",   color: "#6366F1" },
  { id: "tool",     label: "Tool",     color: "#0EA5E9" },
  { id: "external", label: "External", color: "#EC4899" },
  { id: "output",   label: "Output",   color: "#10B981" },
] as const;

// ── Demo Mode Badge (clickable — opens demo story) ───────────────────────────

function DemoBadge() {
  const [showStory, setShowStory] = useState(false);
  return (
    <>
      {/* Fixed bottom-right pill */}
      <button
        onClick={() => setShowStory(true)}
        className="fixed bottom-5 right-5 z-[300] flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold px-3 py-2 rounded-2xl shadow-lg transition-colors cursor-pointer"
        style={{ boxShadow: "0 4px 18px 0 rgba(16,185,129,0.35)" }}
        title="Click to learn about this demo"
      >
        <span className="text-sm leading-none" aria-hidden>🎭</span>
        <div className="flex flex-col leading-tight text-left">
          <span className="font-bold tracking-wide">Demo Mode</span>
          <span className="font-normal opacity-80 text-[10px]">Click to learn more</span>
        </div>
      </button>

      {/* Demo story modal */}
      {showStory && (
        <div className="fixed inset-0 z-[400] flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg mx-4 flex flex-col overflow-hidden border border-slate-100">

            {/* Header */}
            <div className="px-8 pt-7 pb-5 border-b border-slate-100 flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-emerald-100 flex items-center justify-center shrink-0">
                  <span className="text-xl">🎭</span>
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-800">Demo — Jack&apos;s Daily Routine</h2>
                  <p className="text-xs text-emerald-600 font-semibold mt-0.5">Scripted workflow · No API key required</p>
                </div>
              </div>
              <button onClick={() => setShowStory(false)}
                className="p-1.5 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors">
                <span className="text-lg leading-none">×</span>
              </button>
            </div>

            {/* Body */}
            <div className="px-8 py-6 space-y-4 overflow-y-auto max-h-[60vh]">
              <div>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">The Scenario</p>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Jack is a financial analyst who runs a daily data reconciliation between Bloomberg Terminal
                  and an internal PostgreSQL database. When price breaks are found, he must wait for
                  Sarah (Portfolio Manager) to manually review and approve overrides — a bottleneck that
                  blocks the entire end-of-day pipeline.
                </p>
              </div>

              <div>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">What&apos;s Scripted</p>
                <div className="space-y-2">
                  {[
                    { icon: "📝", label: "Workflow description", detail: "Jack's routine is pre-filled in the text input — no typing needed" },
                    { icon: "🔍", label: "AI Analyze", detail: "Identifies Sarah as a bottleneck and proposes an AI Exception Reviewer" },
                    { icon: "✏️", label: "AI Update prompt", detail: "Sarah's promotion scenario — junior analysts added to the approval chain" },
                    { icon: "🤖", label: "AI responses", detail: "All AI calls use built-in mock data — no API key required" },
                  ].map(({ icon, label, detail }) => (
                    <div key={label} className="flex items-start gap-3 p-3 rounded-xl bg-slate-50 border border-slate-100">
                      <span className="text-base shrink-0">{icon}</span>
                      <div>
                        <p className="text-xs font-semibold text-slate-700">{label}</p>
                        <p className="text-xs text-slate-500 mt-0.5">{detail}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">What Works Normally</p>
                <div className="flex flex-wrap gap-2">
                  {["Export PNG", "Export CSV", "Data Flow view", "Canvas zoom & pan", "Node/edge selection", "Groups"].map(f => (
                    <span key={f} className="text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 px-2.5 py-1 rounded-full font-medium">✓ {f}</span>
                  ))}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="px-8 pb-6 pt-4 border-t border-slate-100">
              <button onClick={() => setShowStory(false)}
                className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold transition-colors">
                Got it — explore the demo
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default function Home() {
  // ── App state ──────────────────────────────────────────────────────────────
  const [isAppStarted,          setIsAppStarted]          = useState(false);
  /** Track 15a: true while AI is generating a workflow — overlay shown over empty canvas */
  const [isGeneratingWorkflow,  setIsGeneratingWorkflow]  = useState(false);
  const [workflowGenerationError, setWorkflowGenerationError] = useState<string | null>(null);
  const [showImprovements, setShowImprovements] = useState(false);
  const [showDataFlow,     setShowDataFlow]     = useState(false);
  const [highContrast,     setHighContrast]     = useState(false);
  const [selectedId,   setSelectedId]    = useState<string | null>(null);
  const [selectedType, setSelectedType]  = useState<"node" | "edge" | null>(null);
  const [analysisData, setAnalysisData]  = useState<AnalysisData | null>(null);
  const [tooltip, setTooltip] = useState<{ name: string; summary: string; x: number; y: number; visible: boolean }>
    ({ name: "", summary: "", x: 0, y: 0, visible: false });
  const [showKeyboardHelp, setShowKeyboardHelp] = useState(false);
  const [showLibrary,      setShowLibrary]      = useState(false);
  const [librarySaveName,  setLibrarySaveName]  = useState("");

  const canvasRef   = useRef<GraphCanvasRef>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const workflowCache = useRef<Record<string, any> | null>(null);
  const resetAppliedSuggestionsRef = useRef<() => void>(() => {});

  // ── Composed hooks ─────────────────────────────────────────────────────────
  const { fullServerState, setFullServerState } = useGraphState();

  // ── Undo / Redo (Track 2) ─────────────────────────────────────────────────
  const { push: pushSnapshot, undo: popUndo, redo: popRedo, canUndo, canRedo } = useUndoRedo();

  // Stable ref so keyboard handler never captures a stale closure
  const fullServerStateRef = useRef<typeof fullServerState>(null);
  useEffect(() => { fullServerStateRef.current = fullServerState; }, [fullServerState]);

  /** Apply a historical state to the server and update local state optimistically. */
  const applyHistoryState = useCallback(async (state: NonNullable<typeof fullServerState>) => {
    setFullServerState(state);
    await fetch("/api/graph-state", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action:             "importState",
        baselinePositions:  state.baselinePositions  ?? {},
        ecosystemPositions: state.ecosystemPositions ?? {},
        customNodes:        state.customNodes        ?? [],
        customEdges:        state.customEdges        ?? [],
        settings:           state.settings,
      }),
    }).catch(console.error);
  }, [setFullServerState]);

  const handleUndo = useCallback(async () => {
    const cur = fullServerStateRef.current;
    if (!cur) return;
    const prev = popUndo(cur);
    if (prev) await applyHistoryState(prev);
    resetAppliedSuggestionsRef.current();
  }, [popUndo, applyHistoryState]);

  const handleRedo = useCallback(async () => {
    const cur = fullServerStateRef.current;
    if (!cur) return;
    const next = popRedo(cur);
    if (next) await applyHistoryState(next);
    resetAppliedSuggestionsRef.current();
  }, [popRedo, applyHistoryState]);

  // Track 9: Keyboard shortcuts (Cmd/Ctrl+Z = undo, Cmd/Ctrl+Shift+Z or Ctrl+Y = redo, Cmd+E = export, Cmd+K = search, ? = help)
  useKeyboardShortcuts(isAppStarted, {
    onUndo: handleUndo,
    onRedo: handleRedo,
    onExportCsv: () => canvasRef.current?.exportCsv(),
    onSearchOpen: () => { searchInputRef.current?.focus(); },
  });

  // Track 1: Workflow Library hook
  const { entries: libraryEntries, saveWorkflow, loadWorkflow, deleteWorkflow } = useWorkflowLibrary();



  const {
    searchQuery, setSearchQuery,
    roleFilters, setRoleFilters,
    groupFilters, setGroupFilters,
    showFilters, setShowFilters,
    showGroups, setShowGroups,
    hasActiveFilters, clearAllFilters,
  } = useCanvasFilters();

  const {
    workflowGroups,
    editingGroupId, setEditingGroupId,
    editingGroupName, setEditingGroupName,
    createGroup, renameGroup, changeGroupColor, deleteGroup,
    GROUP_COLORS,
  } = useWorkflowGroups(fullServerState, setFullServerState, setGroupFilters, pushSnapshot);

  const {
    aiConfig, handleSaveAiConfig, activeApiKey,
    showAISettings, setShowAISettings,
    showAIAnalysis, setShowAIAnalysis,
    showAIUpdate,   setShowAIUpdate,
    showDebugLog,   setShowDebugLog,
    aiAnalysis, aiAnalysisLoading, aiAnalysisError, aiAnalysisStreamText, aiAnalysisIsDemo,
    aiSuggestedConnections, aiSuggestedRemovals,
    aiAnalysisTimestamp,
    handleAiAnalyze, handleReAnalyze, resetAnalysis,
    aiUpdateLoading, aiUpdateResult, aiUpdateError,
    handleAiUpdate, handleApplyUpdate, setAiUpdateResult, setAiUpdateError,
    handleAddConnection, handleRemoveEntity,
    appliedRemovalIds, appliedConnectionKeys, appliedEdgeRemovalIds,
    appliedAIGroupIds,
    resetAppliedSuggestions,
    aiSuggestedEdgeRemovals, aiSuggestedNewNodes, aiSuggestedTaskUpdates, aiSuggestedGroupUpdates, aiSuggestionPlan,
    handleRemoveEdge, handleAddNewNode, handleUpdateTasks, handleApplyGroupUpdate,
    aiDebugLog, setAiDebugLog,
  } = useAIHandlers(
    fullServerState, setFullServerState, selectedId, setSelectedId, setSelectedType, pushSnapshot,
    () => { canvasRef.current?.triggerRefresh(); },
  );
  resetAppliedSuggestionsRef.current = resetAppliedSuggestions;

  // ── AI analysis canvas highlights ─────────────────────────────────────────
  // Nodes from AI suggestions that are pending removal (not yet applied) → amber glow
  const pendingBottleneckNodeIds = aiSuggestedRemovals
    .filter(r => r.type === 'node' && !appliedRemovalIds.has(r.id))
    .map(r => r.id);
  // Connection pairs from AI suggestions that are pending addition (not yet applied) → dashed arc
  const pendingSuggestedConnectionPairs = aiSuggestedConnections
    .filter(c => !appliedConnectionKeys.has(`${c.sourceId}-${c.targetId}`))
    .map(c => ({ sourceId: c.sourceId, targetId: c.targetId }));
  // Edge IDs from AI suggestions flagged for removal (not yet applied) → amber/yellow highlight
  const pendingRedundantEdgeIds = aiSuggestedEdgeRemovals
    .filter(r => !appliedEdgeRemovalIds.has(r.edgeId))
    .map(r => r.edgeId);
  // vb0.22: Group IDs created by AI that haven't been cleared → emerald dashed proposed-group highlight
  // These are groups present in appliedAIGroupIds (they were just created by the AI suggestion handler)
  const pendingProposedGroupIds = Array.from(appliedAIGroupIds);

  const activeProviderMeta = PROVIDERS.find((p) => p.id === aiConfig.provider);

  // ── Demo mode ──────────────────────────────────────────────────────────────
  // This branch is permanently demo mode — no user selection needed.
  const isDemoMode = true;

  // ── Workflow cache + tooltip ───────────────────────────────────────────────
  useEffect(() => {
    const handleMove = (e: MouseEvent) =>
      setTooltip((t) => t.visible ? { ...t, x: e.pageX + 15, y: e.pageY + 15 } : t);
    window.addEventListener("mousemove", handleMove);
    return () => window.removeEventListener("mousemove", handleMove);
  }, []);

  useEffect(() => {
    fetch("/api/workflow").then(r => r.json()).then(d => { workflowCache.current = d; }).catch(() => {});
  }, []);

  // ── Sidebar data derivation ────────────────────────────────────────────────
  useEffect(() => {
    if (selectedId && selectedType) {
      const data = workflowCache.current ?? {};
      const dict = selectedType === "node" ? data.nodes ?? {} : data.edges ?? {};
      const info = dict[selectedId] || {};
      let techParams: Partial<AnalysisData> = {};
      if (fullServerState) {
        if (selectedType === "node") {
          techParams.outputDelay = fullServerState.settings?.nodeDelayOverrides?.[selectedId] ?? 1;
        } else {
          techParams.sequence = fullServerState.settings?.edgeWeightOverrides?.[selectedId]?.sequence ?? info.sequence ?? 1;
          techParams.weight   = fullServerState.settings?.edgeWeightOverrides?.[selectedId]?.weight ?? 1;
          const customEdge = fullServerState.customEdges?.find(e => e.id === selectedId);
          if (customEdge) {
            techParams.isImprovementOnly = customEdge.isImprovementOnly;
            techParams.sequence = techParams.sequence ?? customEdge.sequence;
            techParams.weight   = techParams.weight   ?? customEdge.weight;
            techParams.edgeSourceId = customEdge.source;
            techParams.edgeTargetId = customEdge.target;
            const overrides = fullServerState.settings?.metadataOverrides ?? {};
            const srcNode   = fullServerState.customNodes?.find(n => n.id === customEdge.source);
            const tgtNode   = fullServerState.customNodes?.find(n => n.id === customEdge.target);
            techParams.edgeSourceLabel = overrides[customEdge.source]?.name || srcNode?.label || customEdge.source;
            techParams.edgeTargetLabel = overrides[customEdge.target]?.name || tgtNode?.label || customEdge.target;
          }
        }
      }
      setAnalysisData({ ...info, ...techParams, id: selectedId, type: selectedType });
    } else {
      setAnalysisData(null);
    }
  }, [selectedId, selectedType, fullServerState]);

  // Demo: auto-enable improvements view when analysis loads so canvas reflects suggested state
  useEffect(() => {
    if (aiAnalysisIsDemo && aiAnalysis) {
      setShowImprovements(true);
    }
  }, [aiAnalysisIsDemo, aiAnalysis]);

  // ── Import helpers ─────────────────────────────────────────────────────────

  /**
   * Track 15a — called by StartScreen the moment the user clicks "Generate with AI".
   * Immediately transitions to the canvas shell + shows the generating overlay,
   * so the user is never left staring at the frozen start-screen button.
   */
  const handleGenerationStart = () => {
    setWorkflowGenerationError(null);
    setIsAppStarted(true);
    setIsGeneratingWorkflow(true);
  };

  const importStateAndStart = async (result: AIParsedResult) => {
    // Clear any stale AI analysis so the new workflow gets a fresh run
    resetAnalysis();
    await fetch("/api/graph-state", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action:             "importState",
        customNodes:        result.customNodes,
        customEdges:        result.customEdges,
        baselinePositions:  result.baselinePositions,
        ecosystemPositions: result.ecosystemPositions,
        settings: {
          ...(result.metadataOverrides ? { metadataOverrides: result.metadataOverrides } : {}),
          ...(result.workflowGroups   ? { workflowGroups:    result.workflowGroups   } : {}),
          ...(result.settings ?? {}),
        },
      }),
    }).catch(console.error);
    await fetch("/api/graph-state", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "resetLayout" }),
    }).catch(console.error);
    // Clear the generating overlay — workflow is ready
    setIsGeneratingWorkflow(false);
    setIsAppStarted(true);
  };

  /** Called by StartScreen when AI generation fails (error propagated up) */
  const handleGenerationError = (errorMessage: string) => {
    setIsGeneratingWorkflow(false);
    setWorkflowGenerationError(errorMessage);
  };

  /** "Back to start" from the error overlay */
  const handleDismissGenerationError = () => {
    setWorkflowGenerationError(null);
    setIsAppStarted(false);
  };

  const handleAiParsed     = importStateAndStart;
  const handleTemplateLoad = importStateAndStart;

  const handleImportCsv = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => { const text = ev.target?.result as string; if (text) canvasRef.current?.importCsv(text); };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleImportAndStart = (csvText: string) => {
    setIsAppStarted(true);
    setTimeout(() => canvasRef.current?.importCsv(csvText), 400);
  };

  // ── Debug modal (shared between start screen and canvas) ───────────────────
  const debugModal = (
    <>
      {!isDemoMode && (
        <button
          onClick={() => setShowDebugLog(true)}
          className={`fixed bottom-5 left-5 z-[200] flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium shadow-lg transition-colors ${
            aiDebugLog?.error
              ? "bg-red-700 text-white hover:bg-red-600"
              : aiDebugLog
              ? "bg-slate-800 text-slate-100 hover:bg-slate-700"
              : "bg-slate-200 text-slate-500 hover:bg-slate-300"
          }`}
        >
          <FileText className="w-3.5 h-3.5" />
          AI Debug Log{aiDebugLog?.error ? " ⚠" : ""}
        </button>
      )}

      {showDebugLog && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-indigo-500" />
                <span className="font-semibold text-slate-800">AI Debug Log</span>
                {aiDebugLog?.error && (
                  <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-medium">Error</span>
                )}
              </div>
              <button onClick={() => setShowDebugLog(false)} className="p-1 rounded-lg hover:bg-slate-100 text-slate-500">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="overflow-y-auto flex-1 p-6 space-y-5 text-sm">
              {!aiDebugLog ? (
                <p className="text-slate-400 text-center py-8">No parse attempt yet. Submit a workflow description to see debug output here.</p>
              ) : (
                <>
                  {aiDebugLog.error && (
                    <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-red-700">
                      <span className="font-medium">Error: </span>{aiDebugLog.error}
                    </div>
                  )}
                  {/* Engine + Token usage pill row */}
                  {(aiDebugLog.engine || aiDebugLog.tokenUsage) && (
                    <div className="flex items-center gap-3 flex-wrap">
                      {aiDebugLog.engine && (
                        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                          aiDebugLog.engine === 'distributed'
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-indigo-100 text-indigo-700'
                        }`}>
                          {aiDebugLog.engine === 'distributed' ? '⚡ Distributed' : '⬤ Monolithic'} engine
                        </span>
                      )}
                      {aiDebugLog.tokenUsage && (
                        <span className="text-xs font-mono bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full">
                          {aiDebugLog.tokenUsage.inputTokens.toLocaleString()} in · {aiDebugLog.tokenUsage.outputTokens.toLocaleString()} out tokens
                        </span>
                      )}
                      {aiDebugLog.tokenUsage && (
                        <span className="text-xs text-slate-400">
                          ≈ {(aiDebugLog.tokenUsage.inputTokens + aiDebugLog.tokenUsage.outputTokens).toLocaleString()} total
                        </span>
                      )}
                    </div>
                  )}
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Prompt sent ({aiDebugLog.prompt.length.toLocaleString()} chars)</div>
                    <pre className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-xs text-slate-700 whitespace-pre-wrap font-mono overflow-x-auto max-h-48 overflow-y-auto">
                      {aiDebugLog.prompt || "(empty)"}
                    </pre>
                  </div>
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">
                      Raw AI response {aiDebugLog.rawAIResponse ? `(${aiDebugLog.rawAIResponse.length.toLocaleString()} chars)` : "(empty)"}
                    </div>
                    <pre className="bg-slate-950 text-green-400 rounded-lg p-4 text-xs whitespace-pre-wrap font-mono overflow-x-auto max-h-96 overflow-y-auto">
                      {aiDebugLog.rawAIResponse || "(no response received)"}
                    </pre>
                  </div>
                </>
              )}
            </div>
            <div className="px-6 py-3 border-t border-slate-100 flex justify-end gap-2">
              {aiDebugLog?.rawAIResponse && (
                <button
                  onClick={() => navigator.clipboard.writeText(aiDebugLog!.rawAIResponse)}
                  className="text-xs px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 font-medium"
                >
                  Copy response
                </button>
              )}
              <button
                onClick={() => setShowDebugLog(false)}
                className="text-xs px-3 py-1.5 rounded-lg bg-slate-800 text-white hover:bg-slate-700 font-medium"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );

  // ── Start screen ───────────────────────────────────────────────────────────
  if (!isAppStarted) {
    return (
      <>
        <StartScreen
          onStart={() => setIsAppStarted(true)}
          onImportAndStart={handleImportAndStart}
          onAiParsed={handleAiParsed}
          onTemplateLoad={handleTemplateLoad}
          onDebugLog={setAiDebugLog}
          aiConfig={aiConfig}
          onSaveConfig={handleSaveAiConfig}
          onOpenSettings={() => setShowAISettings(true)}
          onGenerationStart={handleGenerationStart}
          onGenerationError={handleGenerationError}
          isDemoMode={isDemoMode}
        />
        <AISettingsModal isOpen={showAISettings} onClose={() => setShowAISettings(false)}
          onSave={handleSaveAiConfig} currentConfig={aiConfig} isDemoMode={isDemoMode} />
        {isDemoMode && <DemoBadge />}
        {debugModal}
      </>
    );
  }

  // ── Canvas app shell ────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-screen relative bg-[#F8FAFC] overflow-hidden font-[var(--font-inter)] text-slate-800 antialiased">

      {/* ── Header ── */}
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between z-50 shadow-sm relative">
        <div className="flex items-center gap-3">
          <button onClick={() => setIsAppStarted(false)} title="Back to home"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <img src="/workable-logo.svg" alt="Workable" className="w-7 h-7" />
          <h1 className="text-xl font-bold tracking-tight">
            <span className="text-indigo-600">Workable</span>
          </h1>
        </div>

        <div className="flex items-center gap-3">
          {/* Undo / Redo (Track 2) */}
          <div className="flex items-center gap-1">
            <button
              onClick={handleUndo}
              disabled={!canUndo}
              title={canUndo ? "Undo (⌘Z)" : "Nothing to undo"}
              aria-label={canUndo ? "Undo" : "Nothing to undo"}
              className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-gray-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <Undo2 className="w-4 h-4" />
            </button>
            <button
              onClick={handleRedo}
              disabled={!canRedo}
              title={canRedo ? "Redo (⌘⇧Z)" : "Nothing to redo"}
              aria-label={canRedo ? "Redo" : "Nothing to redo"}
              className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-gray-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <Redo2 className="w-4 h-4" />
            </button>
          </div>

          <div className="h-6 w-px bg-gray-200" />

          {/* Track 1: Workflow Library */}
          <button
            onClick={() => setShowLibrary(true)}
            title="Workflow Library — save & load named snapshots"
            aria-label="Open workflow library"
            className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-indigo-600 transition-colors"
          >
            <BookOpen className="w-4 h-4" />
          </button>

          {/* Track 9: Keyboard Help */}
          <button
            onClick={() => setShowKeyboardHelp(true)}
            title="Keyboard shortcuts (?)"
            aria-label="Show keyboard shortcuts"
            className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-indigo-600 transition-colors"
          >
            <Keyboard className="w-4 h-4" />
          </button>

          <div className="h-6 w-px bg-gray-200" />

          {/* AI Analyze */}
          <button onClick={handleAiAnalyze}
            title={activeApiKey ? `Analyze with ${activeProviderMeta?.name ?? "AI"}` : "Set an API key to use AI Analyze"}
            aria-label="AI Analyze Workflow"
            className={`text-sm font-semibold px-3 py-1.5 rounded-full border transition-colors flex items-center gap-1.5 ${
              activeApiKey
                ? "border-indigo-300 bg-indigo-50 text-indigo-600 hover:bg-indigo-100"
                : "border-gray-300 text-gray-400 hover:bg-gray-50"
            }`}>
            <Sparkles className="w-4 h-4" />
            AI Analyze
          </button>

          {/* AI Update */}
          <button onClick={() => { if (!activeApiKey) { setShowAISettings(true); return; } setShowAIUpdate(true); }}
            title={activeApiKey ? `Update workflow with ${activeProviderMeta?.name ?? "AI"}` : "Set an API key to use AI Update"}
            aria-label="AI Update Workflow"
            className={`text-sm font-semibold px-3 py-1.5 rounded-full border transition-colors flex items-center gap-1.5 ${
              activeApiKey
                ? "border-violet-300 bg-violet-50 text-violet-600 hover:bg-violet-100"
                : "border-gray-300 text-gray-400 hover:bg-gray-50"
            }`}>
            <GitMerge className="w-4 h-4" />
            AI Update
          </button>

          {/* AI Settings */}
          <button onClick={() => setShowAISettings(true)} title="AI settings"
            aria-label="AI Settings"
            className="text-sm font-semibold p-2 rounded-full border border-gray-300 text-gray-600 hover:bg-gray-50 transition-colors relative">
            <Settings className="w-4 h-4" />
            {activeApiKey && <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-500 border border-white" />}
          </button>

          {/* AI Engine toggle (vb0.2) */}
          <AIEngineToggle compact />

          <div className="h-6 w-px bg-gray-300" />

          <button onClick={() => canvasRef.current?.exportPng()} title="Export graph as PNG"
            aria-label="Export graph as PNG"
            className="text-sm font-semibold px-3 py-1.5 rounded-full border border-gray-300 text-gray-600 hover:bg-gray-50 transition-colors flex items-center gap-1.5">
            <Download className="w-4 h-4" />PNG
          </button>
          <button onClick={() => canvasRef.current?.exportCsv()} title="Export workflow as CSV"
            aria-label="Export workflow as CSV"
            className="text-sm font-semibold px-3 py-1.5 rounded-full border border-gray-300 text-gray-600 hover:bg-gray-50 transition-colors flex items-center gap-1.5">
            <FileText className="w-4 h-4" />CSV
          </button>
          <button onClick={() => importInput.current?.click()} title="Import workflow from CSV"
            aria-label="Import workflow from CSV"
            className="text-sm font-semibold px-3 py-1.5 rounded-full border border-gray-300 text-gray-600 hover:bg-gray-50 transition-colors flex items-center gap-1.5">
            <Upload className="w-4 h-4" />Import
          </button>
          <input ref={importInput} type="file" accept=".csv,text/csv" className="hidden" onChange={handleImportCsv} />

        </div>
      </header>

      {/* ── Body ── */}
      <div className="flex flex-1 overflow-hidden relative">

        {/* ── Left sidebar ── */}
        <aside className="w-80 bg-white border-r border-slate-200 flex flex-col z-40 relative shadow-sm overflow-y-auto">

          {/* View Mode */}
          <div className="p-5 border-b border-slate-100">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">View Mode</h2>
            <div className="space-y-2">
              <button
                className={`w-full text-left p-3.5 rounded-2xl border-2 transition group ${
                  !showImprovements ? "border-indigo-600 bg-indigo-50/50 shadow-sm" : "border-slate-100 bg-white hover:border-indigo-400/60"
                }`}
                onClick={() => setShowImprovements(false)}
              >
                <span className={`flex items-center gap-1.5 font-bold text-sm mb-0.5 ${!showImprovements ? "text-indigo-600" : "text-slate-600 group-hover:text-indigo-500"}`}>
                  <Clock size={13} className="flex-shrink-0" />
                  Current Workflow
                </span>
                <p className="text-xs text-slate-500">Every step and handoff as it is today.</p>
              </button>
              <button
                className={`w-full text-left p-3.5 rounded-2xl border-2 transition group ${
                  showImprovements ? "border-emerald-500 bg-emerald-50/50 shadow-sm" : "border-slate-100 bg-white hover:border-emerald-400/60"
                }`}
                onClick={() => setShowImprovements(true)}
              >
                <span className={`flex items-center gap-1.5 font-bold text-sm mb-0.5 ${showImprovements ? "text-emerald-600" : "text-slate-600 group-hover:text-emerald-500"}`}>
                  <Zap size={13} className="flex-shrink-0" />
                  Optimised Workflow
                </span>
                <p className="text-xs text-slate-500">AI-suggested improvements overlaid.</p>
              </button>
            </div>

            {/* Data Flow toggle */}
            <div className="mt-3 pt-3 border-t border-slate-100">
              <button
                onClick={() => setShowDataFlow(v => !v)}
                className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl border transition-colors ${
                  showDataFlow
                    ? "border-indigo-300 bg-indigo-50 text-indigo-700"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className={`relative flex h-2.5 w-2.5 ${showDataFlow ? "" : "opacity-50"}`}>
                    {showDataFlow && (
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75" />
                    )}
                    <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${showDataFlow ? "bg-indigo-500" : "bg-slate-400"}`} />
                  </span>
                  <span className="text-xs font-semibold">Show Data Flow</span>
                </div>
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                  showDataFlow ? "bg-indigo-100 text-indigo-600" : "bg-slate-100 text-slate-400"
                }`}>
                  {showDataFlow ? "ON" : "OFF"}
                </span>
              </button>
              {showDataFlow && (
                <p className="text-[10px] text-indigo-500 mt-1.5 ml-1">All connections lit — showing live data flow.</p>
              )}
            </div>

            {/* High Contrast toggle */}
            <div className="mt-3 pt-3 border-t border-slate-100">
              <button
                aria-label={highContrast ? "Disable High Contrast" : "Enable High Contrast"}
                onClick={() => setHighContrast(v => !v)}
                className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl border transition-colors ${
                  highContrast
                    ? "border-fuchsia-300 bg-fuchsia-50 text-fuchsia-700"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className={`relative flex h-2.5 w-2.5 ${highContrast ? "" : "opacity-50"}`}>
                    <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${highContrast ? "bg-fuchsia-500" : "bg-slate-400"}`} />
                  </span>
                  <span className="text-xs font-semibold">High Contrast</span>
                </div>
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                  highContrast ? "bg-fuchsia-100 text-fuchsia-600" : "bg-slate-100 text-slate-400"
                }`}>
                  {highContrast ? "ON" : "OFF"}
                </span>
              </button>
            </div>
          </div>

          {/* Search */}
          <div className="p-5 border-b border-slate-100">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">Search</h2>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search nodes by name… (Cmd+K)"
                className="w-full pl-9 pr-8 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200 bg-slate-50"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            {searchQuery.trim() && (
              <p className="text-[11px] text-indigo-500 mt-1.5 ml-1">
                Highlighting nodes matching &ldquo;{searchQuery.trim()}&rdquo;
              </p>
            )}
          </div>

          {/* Filters */}
          <div className="border-b border-slate-100">
            <button
              onClick={() => setShowFilters(v => !v)}
              className="w-full flex items-center justify-between px-5 py-3.5 text-xs font-semibold text-slate-400 uppercase tracking-widest hover:bg-slate-50 transition-colors"
            >
              <span className="flex items-center gap-2">
                Filters
                {(roleFilters.length > 0 || groupFilters.length > 0) && (
                  <span className="bg-indigo-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">
                    {roleFilters.length + groupFilters.length}
                  </span>
                )}
              </span>
              {showFilters ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            </button>

            {showFilters && (
              <div className="px-5 pb-4 space-y-4">
                {/* Role filter */}
                <div>
                  <div className="text-[11px] font-semibold text-slate-500 mb-2">Filter by Role</div>
                  <div className="flex flex-wrap gap-1.5">
                    {ROLE_CHIPS.map(({ id, label, color }) => {
                      const active = roleFilters.includes(id);
                      return (
                        <button
                          key={id}
                          onClick={() => setRoleFilters(f => active ? f.filter(r => r !== id) : [...f, id])}
                          className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border transition-all"
                          style={active
                            ? { background: color + "18", border: `1.5px solid ${color}`, color }
                            : { background: "#F8FAFC", border: "1.5px solid #E2E8F0", color: "#64748B" }
                          }
                        >
                          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: color }} />
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Group filter */}
                {workflowGroups.length > 0 && (
                  <div>
                    <div className="text-[11px] font-semibold text-slate-500 mb-2">Filter by Group</div>
                    <div className="flex flex-wrap gap-1.5">
                      {workflowGroups.map((g) => {
                        const active = groupFilters.includes(g.id);
                        return (
                          <button
                            key={g.id}
                            onClick={() => setGroupFilters(f => active ? f.filter(id => id !== g.id) : [...f, g.id])}
                            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border transition-all"
                            style={active
                              ? { background: g.color + "18", border: `1.5px solid ${g.color}`, color: g.color }
                              : { background: "#F8FAFC", border: "1.5px solid #E2E8F0", color: "#64748B" }
                            }
                          >
                            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: g.color }} />
                            {g.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Clear all */}
                {(roleFilters.length > 0 || groupFilters.length > 0) && (
                  <button onClick={() => { setRoleFilters([]); setGroupFilters([]); }}
                    className="text-[11px] text-slate-500 hover:text-red-500 transition-colors flex items-center gap-1">
                    <X className="w-3 h-3" /> Clear all filters
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Workflow Groups Management */}
          <div className="border-b border-slate-100">
            <button
              onClick={() => setShowGroups(v => !v)}
              className="w-full flex items-center justify-between px-5 py-3.5 text-xs font-semibold text-slate-400 uppercase tracking-widest hover:bg-slate-50 transition-colors"
            >
              <span className="flex items-center gap-2">
                Workflow Groups
                {workflowGroups.length > 0 && (
                  <span className="bg-slate-200 text-slate-600 text-[9px] font-bold px-1.5 py-0.5 rounded-full">
                    {workflowGroups.length}
                  </span>
                )}
              </span>
              {showGroups ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            </button>

            {showGroups && (
              <div className="px-5 pb-4 space-y-2">
                {workflowGroups.length === 0 && (
                  <p className="text-[11px] text-slate-400 italic">
                    No groups yet. Create one to visually chunk your workflow.
                  </p>
                )}

                {workflowGroups.map((group) => (
                  <div key={group.id}
                    className={`group/row rounded-xl border bg-slate-50/70 p-2.5 ${group.parentGroupId ? "ml-4 border-dashed border-slate-200" : "border-slate-100"}`}
                  >
                    <div className="flex items-center gap-2">
                      {group.parentGroupId && (
                        <span className="text-[9px] text-slate-300 font-bold flex-shrink-0">↳</span>
                      )}

                      {/* Color swatch + picker */}
                      <div className="relative flex-shrink-0">
                        <div className="w-4 h-4 rounded" style={{ background: group.color }} />
                        <input
                          type="color"
                          value={group.color}
                          onChange={(e) => changeGroupColor(group.id, e.target.value)}
                          title="Change group color"
                          className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                        />
                      </div>

                      {/* Name — inline edit */}
                      {editingGroupId === group.id ? (
                        <input
                          autoFocus
                          type="text"
                          value={editingGroupName}
                          onChange={(e) => setEditingGroupName(e.target.value)}
                          onBlur={() => {
                            if (editingGroupName.trim()) renameGroup(group.id, editingGroupName.trim());
                            setEditingGroupId(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              if (editingGroupName.trim()) renameGroup(group.id, editingGroupName.trim());
                              setEditingGroupId(null);
                            } else if (e.key === "Escape") {
                              setEditingGroupId(null);
                            }
                          }}
                          className="flex-1 text-xs font-semibold border border-indigo-300 rounded-lg px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-indigo-300 min-w-0"
                          style={{ color: group.color }}
                        />
                      ) : (
                        <span className="flex-1 text-xs font-semibold truncate min-w-0" style={{ color: group.color }}>
                          {group.name}
                        </span>
                      )}

                      <span className="text-[10px] text-slate-400 flex-shrink-0">
                        {group.nodeIds.length} node{group.nodeIds.length !== 1 ? "s" : ""}
                      </span>

                      <div className="flex items-center gap-1 opacity-0 group-hover/row:opacity-100 transition-opacity flex-shrink-0">
                        <button
                          onClick={() => { setEditingGroupId(group.id); setEditingGroupName(group.name); }}
                          title="Rename group"
                          className="p-1 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition-colors"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => deleteGroup(group.id)}
                          title="Delete group"
                          className="p-1 rounded hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>

                    {/* Color presets */}
                    {editingGroupId === group.id && (
                      <div className="mt-2 flex gap-1.5 flex-wrap">
                        {GROUP_COLORS.map((c) => (
                          <button
                            key={c}
                            onClick={() => changeGroupColor(group.id, c)}
                            className="w-4 h-4 rounded transition-transform hover:scale-110"
                            style={{ background: c, outline: group.color === c ? `2px solid ${c}` : undefined, outlineOffset: 1 }}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                ))}

                <button
                  onClick={createGroup}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-dashed border-slate-300 text-slate-500 hover:border-indigo-400 hover:text-indigo-600 hover:bg-indigo-50/50 text-xs font-semibold transition-colors mt-1"
                >
                  <Plus className="w-3.5 h-3.5" /> New Group
                </button>

                <p className="text-[10px] text-slate-400 italic leading-snug">
                  Right-click any node → &ldquo;Add to group&rdquo; to assign members.
                </p>
              </div>
            )}
          </div>

          {/* Tips */}
          <div className="p-5 mt-auto">
            <p className="text-xs text-slate-400 italic text-center border-t border-slate-100 pt-4 leading-relaxed">
              Drag nodes to rearrange. Right-click canvas to add a step.{" "}
              <kbd className="bg-slate-100 border border-slate-200 rounded px-1 font-mono text-[10px]">Del</kbd>{" "}
              to remove. Use <em>AI Analyze</em> for optimisation suggestions.
            </p>
          </div>
        </aside>

        {/* ── Main canvas ── */}
        <main className="flex-1 relative bg-[#F8FAFC] overflow-hidden">

          {/* Track 15a — Skeleton placeholder nodes while AI is generating */}
          {isGeneratingWorkflow && <SkeletonCanvas />}

          {/* Track 15a — Overlay shown over empty canvas during AI generation */}
          <WorkflowGeneratingOverlay
            isVisible={isGeneratingWorkflow || !!workflowGenerationError}
            error={workflowGenerationError}
            onDismissError={handleDismissGenerationError}
          />

          <GraphCanvas
            ref={canvasRef}
            showImprovements={showImprovements}
            showDataFlow={showDataFlow}
            highContrast={highContrast}
            selectedId={selectedId}
            selectedType={selectedType}
            onSelectNode={(id, type) => { setSelectedId(id); setSelectedType(type); }}
            onDeselect={() => { setSelectedId(null); setSelectedType(null); }}
            onHover={(name, summary) => setTooltip((t) => ({ ...t, name, summary, visible: true }))}
            onHoverEnd={() => setTooltip((t) => ({ ...t, visible: false }))}
            onDeleteNode={(id) => { if (selectedId === id) { setSelectedId(null); setSelectedType(null); } }}
            searchQuery={searchQuery}
            activeFilters={{ roles: roleFilters, groupIds: groupFilters }}
            bottleneckNodeIds={pendingBottleneckNodeIds}
            suggestedConnectionPairs={pendingSuggestedConnectionPairs}
            redundantEdgeIds={pendingRedundantEdgeIds}
            proposedGroupIds={pendingProposedGroupIds}
          />

          {/* Active filter badge */}
          {hasActiveFilters && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 bg-white/95 border border-indigo-200 rounded-full px-4 py-1.5 shadow-md text-xs font-semibold text-indigo-600">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
              {searchQuery.trim() ? `"${searchQuery.trim()}"` : ""}
              {roleFilters.length > 0 ? ` · ${roleFilters.join(", ")}` : ""}
              {groupFilters.length > 0 ? ` · ${groupFilters.length} group${groupFilters.length > 1 ? "s" : ""}` : ""}
              <button onClick={clearAllFilters} className="ml-1 text-indigo-400 hover:text-indigo-700 transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Reset Layout */}
          <div className="absolute bottom-6 left-6 z-50">
            <button
              title="Reset layout to default positions"
              onClick={() => canvasRef.current?.triggerResetLayout()}
              className="bg-white/90 backdrop-blur-md border border-slate-200 rounded-full shadow-lg px-3 py-2 text-slate-600 hover:bg-slate-100 flex items-center gap-1.5 text-sm font-semibold transition-colors"
            >
              <LayoutGrid className="w-4 h-4" />
              Reset Layout
            </button>
          </div>
        </main>

        {/* Analysis panel */}
        <AnalysisSidebar
          data={analysisData}
          isOpen={!!selectedId}
          metadataOverrides={fullServerState?.settings?.metadataOverrides}
          nodeSources={Object.fromEntries(
            (fullServerState?.customNodes ?? [])
              .filter(n => n.source)
              .map(n => [n.id, n.source!])
          )}
          onClose={() => { setSelectedId(null); setSelectedType(null); }}
          onDelete={(id) => {
            if (fullServerState) pushSnapshot(fullServerState);
            fetch("/api/graph-state", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "deleteNode", nodeId: id }),
            }).catch(console.error);
            setSelectedId(null);
            setSelectedType(null);
          }}
        />
      </div>

      {/* Hover Tooltip */}
      {tooltip.visible && tooltip.name && (
        <div className="fixed pointer-events-none z-[999] bg-slate-800 text-white text-xs rounded-lg py-2 px-3 shadow-xl max-w-[200px]"
          style={{ left: tooltip.x, top: tooltip.y }}>
          <div className="font-bold text-indigo-400 mb-1">{tooltip.name}</div>
          {tooltip.summary && <div className="text-gray-300 leading-tight">{tooltip.summary}</div>}
        </div>
      )}

      {/* AI Modals */}
      <AISettingsModal isOpen={showAISettings} onClose={() => setShowAISettings(false)}
        onSave={handleSaveAiConfig} currentConfig={aiConfig} isDemoMode={isDemoMode} />
      <AIAnalysisModal
        isOpen={showAIAnalysis}
        isLoading={aiAnalysisLoading}
        analysis={aiAnalysis}
        streamText={aiAnalysisStreamText}
        isDemo={aiAnalysisIsDemo}
        suggestedConnections={aiSuggestedConnections}
        suggestedEdgeRemovals={aiSuggestedEdgeRemovals}
        suggestedRemovals={aiSuggestedRemovals}
        suggestedNewNodes={aiSuggestedNewNodes}
        suggestedTaskUpdates={aiSuggestedTaskUpdates}
        suggestedGroupUpdates={aiSuggestedGroupUpdates}
        suggestionPlan={aiSuggestionPlan}
        error={aiAnalysisError}
        onClose={() => setShowAIAnalysis(false)}
        onAddConnection={handleAddConnection}
        onRemoveEdge={handleRemoveEdge}
        onRemoveEntity={handleRemoveEntity}
        onAddNewNode={handleAddNewNode}
        onUpdateTasks={handleUpdateTasks}
        onApplyGroupUpdate={handleApplyGroupUpdate}
        onReAnalyze={handleReAnalyze}
        analysisTimestamp={aiAnalysisTimestamp}
        appliedConnectionKeys={appliedConnectionKeys}
        appliedRemovalIds={appliedRemovalIds}
      />
      <AIUpdateModal
        isOpen={showAIUpdate}
        isLoading={aiUpdateLoading}
        result={aiUpdateResult}
        error={aiUpdateError}
        onClose={() => { setShowAIUpdate(false); setAiUpdateResult(null); setAiUpdateError(null); }}
        onSubmit={handleAiUpdate}
        onApply={handleApplyUpdate}
        isDemoMode={isDemoMode}
      />

      {/* Demo mode badge — fixed bottom-right */}
      {isDemoMode && <DemoBadge />}

      {debugModal}

      {/* Track 9: Keyboard Help Modal */}
      {showKeyboardHelp && <KeyboardHelpModal onClose={() => setShowKeyboardHelp(false)} />}

      {/* Track 1: Workflow Library Modal */}
      {showLibrary && (
        <div
          className="fixed inset-0 z-[500] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={e => { if (e.target === e.currentTarget) setShowLibrary(false); }}
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-indigo-500" />
                <span className="font-semibold text-slate-800">Workflow Library</span>
              </div>
              <button onClick={() => setShowLibrary(false)} className="p-1 rounded-lg hover:bg-slate-100 text-slate-400">
                <X className="w-4 h-4" />
              </button>
            </div>
            {/* Save current workflow */}
            <div className="px-6 py-3 border-b border-slate-100 flex gap-2">
              <input
                type="text"
                placeholder="Name this workflow…"
                value={librarySaveName}
                onChange={e => setLibrarySaveName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && librarySaveName.trim() && fullServerState) { saveWorkflow(librarySaveName, fullServerState); setLibrarySaveName(''); } }}
                className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
              <button
                onClick={() => { if (librarySaveName.trim() && fullServerState) { saveWorkflow(librarySaveName, fullServerState); setLibrarySaveName(''); } }}
                disabled={!librarySaveName.trim() || !fullServerState}
                className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40 font-medium"
              >
                Save
              </button>
            </div>
            {/* Library list */}
            <div className="overflow-y-auto flex-1 divide-y divide-slate-100">
              {libraryEntries.length === 0 ? (
                <p className="text-slate-400 text-sm text-center py-10">No saved workflows yet.</p>
              ) : libraryEntries.map(entry => (
                <div key={entry.id} className="flex items-center justify-between px-6 py-3 hover:bg-slate-50">
                  <div>
                    <div className="text-sm font-medium text-slate-700">{entry.name}</div>
                    <div className="text-xs text-slate-400">{new Date(entry.savedAt).toLocaleString()}</div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={async () => {
                        const e = loadWorkflow(entry.id);
                        if (!e) return;
                        await fetch('/api/graph-state', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'importState', customNodes: e.state.customNodes ?? [], customEdges: e.state.customEdges ?? [], baselinePositions: e.state.baselinePositions ?? {}, ecosystemPositions: e.state.ecosystemPositions ?? {}, settings: e.state.settings }) });
                        setFullServerState(e.state);
                        setShowLibrary(false);
                      }}
                      className="text-xs px-2 py-1 rounded-lg bg-indigo-50 text-indigo-600 hover:bg-indigo-100 font-medium"
                    >Load</button>
                    <button
                      onClick={() => deleteWorkflow(entry.id)}
                      className="text-xs px-2 py-1 rounded-lg bg-red-50 text-red-500 hover:bg-red-100 font-medium"
                    >Delete</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {/* ── Demo Mode Badge ── */}
      <div className="fixed bottom-6 left-6 z-[100] flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-sm pointer-events-none select-none animate-in fade-in slide-in-from-bottom-4 duration-700">
        <Zap className="w-3.5 h-3.5 fill-emerald-500" />
        <span className="text-[11px] font-bold uppercase tracking-widest">Demo Environment</span>
      </div>
    </div>
  );
}
