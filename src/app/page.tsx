"use client";

import { useState, useEffect, useRef } from "react";
import { StartScreen, type AIParsedResult } from "@/components/StartScreen";
import { GraphCanvas, GraphCanvasRef } from "@/components/GraphCanvas";
import { AnalysisSidebar, AnalysisData } from "@/components/AnalysisSidebar";
import { AISettingsModal, loadAIConfig, type AIConfig } from "@/components/AISettingsModal";
import { AIAnalysisModal, type SuggestedConnection, type SuggestedRemoval } from "@/components/AIAnalysisModal";
import { AI_CONFIG_KEY } from "@/components/AISettingsModal";
import {
  Zap, Download, FileText, Upload, Settings, Sparkles, ChevronLeft,
  LayoutGrid, Search, X, ChevronDown, ChevronRight, Plus, Trash2, Pencil,
} from "lucide-react";
import { PROVIDERS } from "@/lib/aiClient";
import type { ServerGraphState } from "@/lib/serverState";

const ROLE_CHIPS = [
  { id: "person",   label: "Person",   color: "#6366F1" },
  { id: "tool",     label: "Tool",     color: "#0EA5E9" },
  { id: "external", label: "External", color: "#EC4899" },
  { id: "output",   label: "Output",   color: "#10B981" },
] as const;

const GROUP_COLORS = ["#6366F1","#0EA5E9","#10B981","#F59E0B","#EF4444","#8B5CF6","#EC4899","#14B8A6"];

export default function Home() {
  const [isAppStarted, setIsAppStarted]           = useState(false);
  const [showImprovements, setShowImprovements]   = useState(false);
  const [selectedId, setSelectedId]               = useState<string | null>(null);
  const [selectedType, setSelectedType]           = useState<"node" | "edge" | null>(null);
  const [analysisData, setAnalysisData]           = useState<AnalysisData | null>(null);
  const [fullServerState, setFullServerState]     = useState<ServerGraphState | null>(null);

  // Search + Filter
  const [searchQuery, setSearchQuery]             = useState("");
  const [roleFilters, setRoleFilters]             = useState<string[]>([]);
  const [groupFilters, setGroupFilters]           = useState<string[]>([]);
  const [showFilters, setShowFilters]             = useState(false);
  const [showGroups, setShowGroups]               = useState(true);

  // Workgroup management state
  const [editingGroupId, setEditingGroupId]       = useState<string | null>(null);
  const [editingGroupName, setEditingGroupName]   = useState("");

  const aiConfig0 = loadAIConfig;
  const [aiConfig, setAiConfig]                   = useState<AIConfig>(aiConfig0);
  const [showAISettings, setShowAISettings]       = useState(false);
  const [showAIAnalysis, setShowAIAnalysis]       = useState(false);
  const [aiAnalysis, setAiAnalysis]               = useState<string | null>(null);
  const [aiAnalysisLoading, setAiAnalysisLoading] = useState(false);
  const [aiAnalysisError, setAiAnalysisError]     = useState<string | null>(null);
  const [aiSuggestedConnections, setAiSuggestedConnections] = useState<SuggestedConnection[]>([]);
  const [aiSuggestedRemovals, setAiSuggestedRemovals]       = useState<SuggestedRemoval[]>([]);

  const [tooltip, setTooltip] = useState<{ name: string; summary: string; x: number; y: number; visible: boolean }>
    ({ name: "", summary: "", x: 0, y: 0, visible: false });

  const canvasRef   = useRef<GraphCanvasRef>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const workflowCache = useRef<Record<string, any> | null>(null);

  useEffect(() => { setAiConfig(loadAIConfig()); }, []);

  const handleSaveAiConfig = (config: AIConfig) => {
    setAiConfig(config);
    localStorage.setItem(AI_CONFIG_KEY, JSON.stringify(config));
  };

  const activeApiKey = aiConfig.keys[aiConfig.provider]?.trim() ?? "";
  const activeProviderMeta = PROVIDERS.find((p) => p.id === aiConfig.provider);

  const importStateAndStart = async (result: AIParsedResult) => {
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
    setIsAppStarted(true);
  };

  const handleAiParsed     = importStateAndStart;
  const handleTemplateLoad = importStateAndStart;

  const handleAiAnalyze = async () => {
    if (!activeApiKey) { setShowAISettings(true); return; }
    setAiAnalysis(null);
    setAiAnalysisError(null);
    setAiSuggestedConnections([]);
    setAiSuggestedRemovals([]);
    setAiAnalysisLoading(true);
    setShowAIAnalysis(true);
    try {
      const res = await fetch("/api/ai/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workflowData: fullServerState,
          apiKey:       activeApiKey,
          provider:     aiConfig.provider,
          model:        aiConfig.models[aiConfig.provider],
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAiAnalysisError(data.error ?? "Analysis failed.");
      } else {
        setAiAnalysis(data.analysis);
        setAiSuggestedConnections(data.suggestedConnections ?? []);
        setAiSuggestedRemovals(data.suggestedRemovals ?? []);
      }
    } catch {
      setAiAnalysisError("Network error. Please try again.");
    } finally {
      setAiAnalysisLoading(false);
    }
  };

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

  useEffect(() => {
    const handleMove = (e: MouseEvent) =>
      setTooltip((t) => t.visible ? { ...t, x: e.pageX + 15, y: e.pageY + 15 } : t);
    window.addEventListener("mousemove", handleMove);
    return () => window.removeEventListener("mousemove", handleMove);
  }, []);

  useEffect(() => {
    fetch("/api/workflow").then(r => r.json()).then(d => { workflowCache.current = d; }).catch(() => {});
  }, []);

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
          }
        }
      }
      setAnalysisData({ ...info, ...techParams, id: selectedId, type: selectedType });
    } else {
      setAnalysisData(null);
    }
  }, [selectedId, selectedType, fullServerState]);

  const lastPollTs = useRef(0);
  useEffect(() => {
    const pull = () =>
      fetch(`/api/graph-state?since=${lastPollTs.current}`)
        .then(r => r.json())
        .then((s: ServerGraphState & { unchanged?: boolean }) => {
          if (s.unchanged) return;
          lastPollTs.current = s.lastUpdated;
          setFullServerState(s);
        }).catch(() => {});
    pull();
    const t = setInterval(pull, 3000);
    return () => clearInterval(t);
  }, []);

  // ── Workgroup helpers ─────────────────────────────────────────────────────
  const workflowGroups = fullServerState?.settings?.workflowGroups ?? [];

  const createGroup = () => {
    const id    = `group-${Date.now()}`;
    const color = GROUP_COLORS[workflowGroups.length % GROUP_COLORS.length];
    const group = { id, name: "New Group", color, nodeIds: [] };
    fetch("/api/graph-state", { method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "upsertWorkflowGroup", group }) }).catch(console.error);
    // optimistic update
    setFullServerState(prev => prev ? {
      ...prev,
      settings: { ...prev.settings!, workflowGroups: [...(prev.settings?.workflowGroups ?? []), group] },
    } : prev);
    // start editing its name right away
    setEditingGroupId(id);
    setEditingGroupName("New Group");
  };

  const renameGroup = (id: string, name: string) => {
    const group = workflowGroups.find(g => g.id === id);
    if (!group) return;
    const updated = { ...group, name };
    fetch("/api/graph-state", { method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "upsertWorkflowGroup", group: updated }) }).catch(console.error);
    setFullServerState(prev => prev ? {
      ...prev,
      settings: { ...prev.settings!, workflowGroups: (prev.settings?.workflowGroups ?? []).map(g => g.id === id ? updated : g) },
    } : prev);
  };

  const changeGroupColor = (id: string, color: string) => {
    const group = workflowGroups.find(g => g.id === id);
    if (!group) return;
    const updated = { ...group, color };
    fetch("/api/graph-state", { method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "upsertWorkflowGroup", group: updated }) }).catch(console.error);
    setFullServerState(prev => prev ? {
      ...prev,
      settings: { ...prev.settings!, workflowGroups: (prev.settings?.workflowGroups ?? []).map(g => g.id === id ? updated : g) },
    } : prev);
  };

  const deleteGroup = (id: string) => {
    fetch("/api/graph-state", { method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "deleteWorkflowGroup", groupId: id }) }).catch(console.error);
    setFullServerState(prev => prev ? {
      ...prev,
      settings: { ...prev.settings!, workflowGroups: (prev.settings?.workflowGroups ?? []).filter(g => g.id !== id) },
    } : prev);
    setGroupFilters(f => f.filter(gid => gid !== id));
  };

  const handleAddConnection = (conn: SuggestedConnection) => {
    const edgeId = `${conn.sourceId}-${conn.targetId}-opt`;
    const newEdge = {
      id: edgeId, source: conn.sourceId, target: conn.targetId,
      sequence: 1, weight: 1, isCustom: true, isImprovementOnly: true,
    };
    fetch("/api/graph-state", { method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "addEdge", edge: newEdge }) }).catch(console.error);
    setFullServerState(prev => prev ? {
      ...prev,
      customEdges: [...(prev.customEdges ?? []).filter(e => e.id !== edgeId), newEdge],
    } : prev);
  };

  const handleRemoveEntity = (removal: SuggestedRemoval) => {
    if (removal.type === "node") {
      fetch("/api/graph-state", { method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "deleteNode", nodeId: removal.id }) }).catch(console.error);
      setFullServerState(prev => prev ? {
        ...prev,
        customNodes: (prev.customNodes ?? []).filter(n => n.id !== removal.id),
        customEdges: (prev.customEdges ?? []).filter(e => e.source !== removal.id && e.target !== removal.id),
      } : prev);
      if (selectedId === removal.id) { setSelectedId(null); setSelectedType(null); }
    }
  };

  const hasActiveFilters = roleFilters.length > 0 || groupFilters.length > 0 || searchQuery.trim().length > 0;

  if (!isAppStarted) {
    return (
      <>
        <StartScreen
          onStart={() => setIsAppStarted(true)}
          onImportAndStart={handleImportAndStart}
          onAiParsed={handleAiParsed}
          onTemplateLoad={handleTemplateLoad}
          aiConfig={aiConfig}
          onSaveConfig={handleSaveAiConfig}
          onOpenSettings={() => setShowAISettings(true)}
        />
        <AISettingsModal isOpen={showAISettings} onClose={() => setShowAISettings(false)}
          onSave={handleSaveAiConfig} currentConfig={aiConfig} />
      </>
    );
  }

  return (
    <div className="flex flex-col h-screen relative bg-[#F8FAFC] overflow-hidden font-[var(--font-inter)] text-slate-800 antialiased">

      {/* ── Header ── */}
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between z-50 shadow-sm relative">
        <div className="flex items-center gap-3">
          <button onClick={() => setIsAppStarted(false)} title="Back to home"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <Zap className="w-7 h-7 text-indigo-600" />
          <h1 className="text-xl font-bold tracking-tight">
            <span className="text-indigo-600">Workable</span>
          </h1>
        </div>

        <div className="flex items-center gap-3">
          {/* AI Analyze */}
          <button onClick={handleAiAnalyze}
            title={activeApiKey ? `Analyze with ${activeProviderMeta?.name ?? "AI"}` : "Set an API key to use AI Analyze"}
            className={`text-sm font-semibold px-3 py-1.5 rounded-full border transition-colors flex items-center gap-1.5 ${
              activeApiKey
                ? "border-indigo-300 bg-indigo-50 text-indigo-600 hover:bg-indigo-100"
                : "border-gray-300 text-gray-400 hover:bg-gray-50"
            }`}>
            <Sparkles className="w-4 h-4" />
            AI Analyze
          </button>

          {/* AI Settings */}
          <button onClick={() => setShowAISettings(true)} title="AI settings"
            className="text-sm font-semibold p-2 rounded-full border border-gray-300 text-gray-600 hover:bg-gray-50 transition-colors relative">
            <Settings className="w-4 h-4" />
            {activeApiKey && <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-500 border border-white" />}
          </button>

          <div className="h-6 w-px bg-gray-300" />

          <button onClick={() => canvasRef.current?.exportPng()} title="Export graph as PNG"
            className="text-sm font-semibold px-3 py-1.5 rounded-full border border-gray-300 text-gray-600 hover:bg-gray-50 transition-colors flex items-center gap-1.5">
            <Download className="w-4 h-4" />PNG
          </button>
          <button onClick={() => canvasRef.current?.exportCsv()} title="Export workflow as CSV"
            className="text-sm font-semibold px-3 py-1.5 rounded-full border border-gray-300 text-gray-600 hover:bg-gray-50 transition-colors flex items-center gap-1.5">
            <FileText className="w-4 h-4" />CSV
          </button>
          <button onClick={() => importInput.current?.click()} title="Import workflow from CSV"
            className="text-sm font-semibold px-3 py-1.5 rounded-full border border-gray-300 text-gray-600 hover:bg-gray-50 transition-colors flex items-center gap-1.5">
            <Upload className="w-4 h-4" />Import
          </button>
          <input ref={importInput} type="file" accept=".csv,text/csv" className="hidden" onChange={handleImportCsv} />

          <div className="h-6 w-px bg-gray-300" />

          {/* Improvements toggle */}
          <button onClick={() => setShowImprovements((v) => !v)}
            className={`text-sm font-semibold px-4 py-1.5 rounded-full border transition-colors flex items-center gap-2 ${
              showImprovements
                ? "border-emerald-500 bg-emerald-50 text-emerald-600"
                : "border-slate-300 text-slate-600 hover:bg-slate-50"
            }`}>
            <span className={`w-2 h-2 rounded-full ${showImprovements ? "bg-emerald-500 shadow-[0_0_8px_#10B981]" : "bg-slate-400"}`} />
            Improvements: {showImprovements ? "On" : "Off"}
          </button>

          <div className="h-6 w-px bg-slate-300" />
          <div className="w-8 h-8 rounded-full bg-indigo-50 flex items-center justify-center font-bold text-indigo-600 border border-indigo-100">XY</div>
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
                <span className={`font-bold text-sm block mb-0.5 ${!showImprovements ? "text-indigo-600" : "text-slate-600 group-hover:text-indigo-500"}`}>
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
                <span className={`font-bold text-sm block mb-0.5 ${showImprovements ? "text-emerald-600" : "text-slate-600 group-hover:text-emerald-500"}`}>
                  Optimised Workflow
                </span>
                <p className="text-xs text-slate-500">AI-suggested improvements overlaid.</p>
              </button>
            </div>
          </div>

          {/* Search */}
          <div className="p-5 border-b border-slate-100">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">Search</h2>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search nodes by name…"
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
                Highlighting nodes matching "{searchQuery.trim()}"
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

                {/* Clear all filters */}
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

                {/* Sort: top-level first, then subgroups indented under their parent */}
                {workflowGroups.map((group) => (
                  <div key={group.id}
                    className={`group/row rounded-xl border bg-slate-50/70 p-2.5 ${group.parentGroupId ? "ml-4 border-dashed border-slate-200" : "border-slate-100"}`}
                  >
                    <div className="flex items-center gap-2">
                      {/* Subgroup indent indicator */}
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

                      {/* Member count */}
                      <span className="text-[10px] text-slate-400 flex-shrink-0">
                        {group.nodeIds.length} node{group.nodeIds.length !== 1 ? "s" : ""}
                      </span>

                      {/* Actions (shown on row hover) */}
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
                  Right-click any node → "Add to group" to assign members.
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
          <GraphCanvas
            ref={canvasRef}
            showImprovements={showImprovements}
            selectedId={selectedId}
            selectedType={selectedType}
            onSelectNode={(id, type) => { setSelectedId(id); setSelectedType(type); }}
            onDeselect={() => { setSelectedId(null); setSelectedType(null); }}
            onHover={(name, summary) => setTooltip((t) => ({ ...t, name, summary, visible: true }))}
            onHoverEnd={() => setTooltip((t) => ({ ...t, visible: false }))}
            onDeleteNode={(id) => { if (selectedId === id) { setSelectedId(null); setSelectedType(null); } }}
            searchQuery={searchQuery}
            activeFilters={{ roles: roleFilters, groupIds: groupFilters }}
          />

          {/* Active filter badge (bottom of canvas) */}
          {hasActiveFilters && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 bg-white/95 border border-indigo-200 rounded-full px-4 py-1.5 shadow-md text-xs font-semibold text-indigo-600">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
              {searchQuery.trim() ? `"${searchQuery.trim()}"` : ""}
              {roleFilters.length > 0 ? ` · ${roleFilters.join(", ")}` : ""}
              {groupFilters.length > 0 ? ` · ${groupFilters.length} group${groupFilters.length > 1 ? "s" : ""}` : ""}
              <button onClick={() => { setSearchQuery(""); setRoleFilters([]); setGroupFilters([]); }}
                className="ml-1 text-indigo-400 hover:text-indigo-700 transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Reset Layout */}
          <div className="absolute bottom-6 left-6 z-50">
            <button
              title="Reset layout to default positions"
              onClick={async () => {
                await fetch("/api/graph-state", {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ action: "resetLayout" }),
                }).catch(console.error);
              }}
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
          onClose={() => { setSelectedId(null); setSelectedType(null); }}
          onDelete={(id) => {
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
        onSave={handleSaveAiConfig} currentConfig={aiConfig} />
      <AIAnalysisModal
        isOpen={showAIAnalysis}
        isLoading={aiAnalysisLoading}
        analysis={aiAnalysis}
        suggestedConnections={aiSuggestedConnections}
        suggestedRemovals={aiSuggestedRemovals}
        error={aiAnalysisError}
        onClose={() => setShowAIAnalysis(false)}
        onAddConnection={handleAddConnection}
        onRemoveEntity={handleRemoveEntity}
      />
    </div>
  );
}
