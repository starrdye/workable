"use client";

import { useState, useEffect, useRef } from "react";
import { StartScreen, type AIParsedResult } from "@/components/StartScreen";
import { GraphCanvas, GraphCanvasRef } from "@/components/GraphCanvas";
import { AnalysisSidebar, AnalysisData } from "@/components/AnalysisSidebar";
import { AISettingsModal, loadAIConfig, type AIConfig } from "@/components/AISettingsModal";
import { AIAnalysisModal } from "@/components/AIAnalysisModal";
import { AI_CONFIG_KEY } from "@/components/AISettingsModal";
import { Zap, Users, AlignJustify, Download, FileText, Upload, Settings, Sparkles, ChevronLeft, LayoutGrid } from "lucide-react";
import { PROVIDERS } from "@/lib/aiClient";

export default function Home() {
  const [isAppStarted, setIsAppStarted]           = useState(false);
  const [isEcosystem, setIsEcosystem]             = useState(false);
  const [showImprovements, setShowImprovements]   = useState(false);
  const [selectedId, setSelectedId]               = useState<string | null>(null);
  const [selectedType, setSelectedType]           = useState<"node" | "edge" | null>(null);
  const [analysisData, setAnalysisData]           = useState<AnalysisData | null>(null);
  const [metadataOverrides, setMetadataOverrides] = useState<Record<string, Partial<AnalysisData>>>({});
  const [fullServerState, setFullServerState]     = useState<any>(null);

  // AI state
  const [aiConfig, setAiConfig]                   = useState<AIConfig>(() => {
    // Runs only on client after hydration
    if (typeof window === "undefined") return loadAIConfig();
    return loadAIConfig();
  });
  const [showAISettings, setShowAISettings]       = useState(false);
  const [showAIAnalysis, setShowAIAnalysis]       = useState(false);
  const [aiAnalysis, setAiAnalysis]               = useState<string | null>(null);
  const [aiAnalysisLoading, setAiAnalysisLoading] = useState(false);
  const [aiAnalysisError, setAiAnalysisError]     = useState<string | null>(null);

  // Hover tooltip
  const [tooltip, setTooltip] = useState<{
    name: string; summary: string; x: number; y: number; visible: boolean;
  }>({ name: "", summary: "", x: 0, y: 0, visible: false });

  const canvasRef   = useRef<GraphCanvasRef>(null);
  const importInput = useRef<HTMLInputElement>(null);

  // Load AI config from localStorage on mount (handles SSR)
  useEffect(() => { setAiConfig(loadAIConfig()); }, []);

  const handleSaveAiConfig = (config: AIConfig) => {
    setAiConfig(config);
    localStorage.setItem(AI_CONFIG_KEY, JSON.stringify(config));
  };

  // Derive active key for current provider
  const activeApiKey = aiConfig.keys[aiConfig.provider]?.trim() ?? "";
  const activeProviderMeta = PROVIDERS.find((p) => p.id === aiConfig.provider);

  // ── Shared importState helper ────────────────────────────────────────────
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
          ...(result.settings ?? {}),
        },
      }),
    }).catch(console.error);
    setIsAppStarted(true);
  };

  // ── AI workflow generation from StartScreen ─────────────────────────────
  const handleAiParsed = (result: AIParsedResult) => importStateAndStart(result);

  // ── Template selection from gallery ──────────────────────────────────────
  const handleTemplateLoad = (result: AIParsedResult) => importStateAndStart(result);

  // ── AI optimization analysis ────────────────────────────────────────────
  const handleAiAnalyze = async () => {
    if (!activeApiKey) { setShowAISettings(true); return; }
    setAiAnalysis(null);
    setAiAnalysisError(null);
    setAiAnalysisLoading(true);
    setShowAIAnalysis(true);
    try {
      const res = await fetch("/api/ai/optimize", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workflowData: fullServerState,
          apiKey:       activeApiKey,
          provider:     aiConfig.provider,
          model:        aiConfig.models[aiConfig.provider],
        }),
      });
      const data = await res.json();
      if (!res.ok) setAiAnalysisError(data.error ?? "Analysis failed.");
      else setAiAnalysis(data.analysis);
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
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      if (text) canvasRef.current?.importCsv(text);
    };
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
    if (selectedId && selectedType) {
      fetch("/api/workflow")
        .then((r) => r.json())
        .then((data) => {
          const dict = selectedType === "node" ? data.nodes : data.edges;
          const info = dict[selectedId] || {};
          let techParams: Partial<AnalysisData> = {};
          if (fullServerState) {
            if (selectedType === "node") {
              techParams.outputDelay = fullServerState.settings?.nodeDelayOverrides?.[selectedId] ?? 1;
            } else {
              techParams.sequence = fullServerState.settings?.edgeWeightOverrides?.[selectedId]?.sequence ?? info.sequence ?? 1;
              techParams.weight   = fullServerState.settings?.edgeWeightOverrides?.[selectedId]?.weight ?? 1;
              const customEdge = fullServerState.customEdges?.find((e: any) => e.id === selectedId);
              if (customEdge) {
                techParams.isImprovementOnly = customEdge.isImprovementOnly;
                techParams.sequence = techParams.sequence ?? customEdge.sequence;
                techParams.weight   = techParams.weight   ?? customEdge.weight;
              }
            }
          }
          setAnalysisData({ ...info, ...techParams, id: selectedId, type: selectedType });
        })
        .catch(console.error);
    } else {
      setAnalysisData(null);
    }
  }, [selectedId, selectedType, fullServerState]);

  useEffect(() => {
    const pull = () =>
      fetch("/api/graph-state").then(r => r.json()).then(s => {
        setFullServerState(s);
        if (s?.settings?.metadataOverrides) setMetadataOverrides(s.settings.metadataOverrides);
      }).catch(() => {});
    pull();
    const t = setInterval(pull, 3000);
    return () => clearInterval(t);
  }, []);

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
        <AISettingsModal
          isOpen={showAISettings}
          onClose={() => setShowAISettings(false)}
          onSave={handleSaveAiConfig}
          currentConfig={aiConfig}
        />
      </>
    );
  }

  return (
    <div className="flex flex-col h-screen relative bg-[#F8FAFC] overflow-hidden font-[var(--font-inter)] text-slate-800 antialiased">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between z-50 shadow-sm relative">
        <div className="flex items-center gap-3">
          {/* Back to start screen */}
          <button
            onClick={() => setIsAppStarted(false)}
            title="Back to home"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <Zap className="w-7 h-7 text-indigo-600" />
          <h1 className="text-xl font-bold tracking-tight">
            Ridgeview <span className="text-indigo-600">Workflow Twin</span>
          </h1>
        </div>

        <div className="flex items-center gap-3">

          {/* AI Analyze */}
          <button
            onClick={handleAiAnalyze}
            title={activeApiKey ? `Analyze with ${activeProviderMeta?.name ?? "AI"}` : "Set an API key to use AI Analyze"}
            className={`text-sm font-semibold px-3 py-1.5 rounded-full border transition-colors flex items-center gap-1.5 ${
              activeApiKey
                ? "border-indigo-300 bg-indigo-50 text-indigo-600 hover:bg-indigo-100"
                : "border-gray-300 text-gray-400 hover:bg-gray-50"
            }`}
          >
            <Sparkles className="w-4 h-4" />
            AI Analyze
          </button>

          {/* AI Settings gear */}
          <button
            onClick={() => setShowAISettings(true)}
            title="AI settings"
            className="text-sm font-semibold p-2 rounded-full border border-gray-300 text-gray-600 hover:bg-gray-50 transition-colors relative"
          >
            <Settings className="w-4 h-4" />
            {activeApiKey && (
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-500 border border-white" />
            )}
          </button>

          <div className="h-6 w-px bg-gray-300" />

          {/* Export / Import */}
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
          <button
            onClick={() => setShowImprovements((v) => !v)}
            className={`text-sm font-semibold px-4 py-1.5 rounded-full border transition-colors flex items-center gap-2 ${
              showImprovements
                ? "border-emerald-500 bg-emerald-50 text-emerald-600"
                : "border-slate-300 text-slate-600 hover:bg-slate-50"
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${showImprovements ? "bg-emerald-500 shadow-[0_0_8px_#10B981]" : "bg-slate-400"}`} />
            Improvements: {showImprovements ? "On" : "Off"}
          </button>

          <div className="h-6 w-px bg-slate-300" />
          <div className="w-8 h-8 rounded-full bg-indigo-50 flex items-center justify-center font-bold text-indigo-600 border border-indigo-100">
            XY
          </div>
        </div>
      </header>

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden relative">

        {/* Left sidebar */}
        <aside className="w-80 bg-white border-r border-slate-200 p-6 flex flex-col gap-6 z-40 relative shadow-sm">
          <section>
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-4">Network Scenarios</h2>
            <div className="space-y-3">
              <button
                className={`w-full text-left p-4 rounded-2xl border-2 transition group ${
                  !showImprovements ? "border-indigo-600 bg-indigo-50/50 shadow-sm" : "border-slate-100 bg-white hover:border-indigo-400/60"
                }`}
                onClick={() => setShowImprovements(false)}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className={`font-bold text-sm ${!showImprovements ? "text-indigo-600" : "text-slate-600 group-hover:text-indigo-500"}`}>
                    Baseline Workflow
                  </span>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Xingye compiles data via Tools, gets Mary&apos;s OK, then Edward&apos;s OK before Dashboard.
                </p>
              </button>

              <button
                className={`w-full text-left p-4 rounded-2xl border-2 transition group ${
                  showImprovements ? "border-emerald-500 bg-emerald-50/50 shadow-sm" : "border-slate-100 bg-white hover:border-emerald-400/60"
                }`}
                onClick={() => setShowImprovements(true)}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className={`font-bold text-sm ${showImprovements ? "text-emerald-600" : "text-slate-600 group-hover:text-emerald-500"}`}>
                    Automated Check
                  </span>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Edward bypassed. Once Mary approves, Ridgeview Dashboard generates directly.
                </p>
              </button>
            </div>
          </section>

          <section className="mt-auto">
            <p className="text-xs text-slate-400 italic text-center border-t border-slate-100 pt-4">
              Tip: Drag nodes to rearrange. Right-click canvas to add a node. Press{" "}
              <kbd className="bg-slate-100 border border-slate-200 rounded px-1 font-mono text-[10px]">Del</kbd>{" "}
              to remove selected.
            </p>
          </section>
        </aside>

        {/* Main canvas */}
        <main className="flex-1 relative bg-[#F8FAFC] overflow-hidden">
          <GraphCanvas
            ref={canvasRef}
            isEcosystem={isEcosystem}
            showImprovements={showImprovements}
            selectedId={selectedId}
            selectedType={selectedType}
            onSelectNode={(id, type) => { setSelectedId(id); setSelectedType(type); }}
            onDeselect={() => { setSelectedId(null); setSelectedType(null); }}
            onHover={(name, summary) => setTooltip((t) => ({ ...t, name, summary, visible: true }))}
            onHoverEnd={() => setTooltip((t) => ({ ...t, visible: false }))}
            onDeleteNode={(id) => { if (selectedId === id) { setSelectedId(null); setSelectedType(null); } }}
          />

          {/* View toggle + Reset Layout */}
          <div className="absolute bottom-6 left-6 z-50 flex items-center gap-2">
            <div className="bg-white/90 backdrop-blur-md border border-slate-200 rounded-full shadow-lg flex gap-1 p-1.5 items-center">
              <button
                onClick={() => { setSelectedId(null); setSelectedType(null); setIsEcosystem((v) => !v); }}
                className="px-4 py-2 hover:bg-slate-100 rounded-full text-slate-700 flex items-center gap-2 font-semibold text-sm transition-all duration-300"
              >
                {!isEcosystem
                  ? <><Users className="w-5 h-5 text-indigo-600" />Switch to Web Map</>
                  : <><AlignJustify className="w-5 h-5 text-slate-600" />Switch to Process Map</>}
              </button>
            </div>
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
          metadataOverrides={metadataOverrides}
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

      {/* ── Hover Tooltip ─────────────────────────────────────────────────── */}
      {tooltip.visible && tooltip.name && (
        <div
          className="fixed pointer-events-none z-[999] bg-slate-800 text-white text-xs rounded-lg py-2 px-3 shadow-xl max-w-[200px]"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          <div className="font-bold text-indigo-400 mb-1">{tooltip.name}</div>
          {tooltip.summary && <div className="text-gray-300 leading-tight">{tooltip.summary}</div>}
        </div>
      )}

      {/* ── AI Modals ──────────────────────────────────────────────────────── */}
      <AISettingsModal
        isOpen={showAISettings}
        onClose={() => setShowAISettings(false)}
        onSave={handleSaveAiConfig}
        currentConfig={aiConfig}
      />
      <AIAnalysisModal
        isOpen={showAIAnalysis}
        isLoading={aiAnalysisLoading}
        analysis={aiAnalysis}
        error={aiAnalysisError}
        onClose={() => setShowAIAnalysis(false)}
      />
    </div>
  );
}
