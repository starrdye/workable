"use client";
import { useRef, useState } from "react";
import {
  Zap, ArrowRight, UploadCloud, FileText,
  Sparkles, Loader2, AlertCircle, Settings,
} from "lucide-react";
import type { CustomNodeConfig, CustomEdgeConfig } from "@/lib/serverState";
import type { AIConfig } from "@/components/AISettingsModal";
import { PROVIDERS, type AIProvider } from "@/lib/aiClient";

// Dot colour per provider
const DOT: Record<AIProvider, string> = {
  anthropic: "bg-indigo-500",
  gemini:    "bg-blue-500",
  doubao:    "bg-violet-500",
};

export interface AIParsedResult {
  customNodes:        CustomNodeConfig[];
  customEdges:        CustomEdgeConfig[];
  baselinePositions:  Record<string, { x: number; y: number }>;
  ecosystemPositions: Record<string, { x: number; y: number }>;
  metadataOverrides?: Record<string, { summary?: string }>;
}

interface StartScreenProps {
  onStart:           () => void;
  onImportAndStart?: (csvText: string) => void;
  onAiParsed?:       (result: AIParsedResult) => void;
  aiConfig?:         AIConfig;
  onSaveConfig?:     (config: AIConfig) => void;
  onOpenSettings?:   () => void;
}

export function StartScreen({
  onStart, onImportAndStart, onAiParsed,
  aiConfig, onSaveConfig: _onSaveConfig, onOpenSettings,
}: StartScreenProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName]         = useState<string | null>(null);
  const [csvText, setCsvText]           = useState<string | null>(null);
  const [instructions, setInstructions] = useState("");
  const [isParsingAI, setIsParsingAI]   = useState(false);
  const [aiError, setAiError]           = useState<string | null>(null);

  const cfg            = aiConfig;
  const activeProvider = cfg?.provider ?? "anthropic";
  const activeKey      = cfg?.keys?.[activeProvider]?.trim() ?? "";
  const activeMeta     = PROVIDERS.find((p) => p.id === activeProvider)!;
  const activeModel = cfg?.models?.[activeProvider] ?? activeMeta.defaultModel;
  // Doubao uses a free-text endpoint ID; other providers show the human label
  const activeModelLabel = activeMeta.usesEndpointId
    ? (activeModel || "no endpoint set")
    : (activeMeta.models.find((m) => m.id === activeModel)?.label ?? activeModel);

  // ── File handling ─────────────────────────────────────────────────────
  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) readFile(file);
  };
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) readFile(file);
    e.target.value = "";
  };
  const readFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      if (text) { setCsvText(text); setFileName(file.name); }
    };
    reader.readAsText(file);
  };

  // ── Primary action ────────────────────────────────────────────────────
  const handleLoadWorkflow = async () => {
    setAiError(null);
    if (csvText && onImportAndStart) { onImportAndStart(csvText); return; }
    if (instructions.trim() && activeKey && cfg && onAiParsed) {
      setIsParsingAI(true);
      try {
        const res = await fetch("/api/ai/parse-workflow", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt:   instructions.trim(),
            apiKey:   activeKey,
            provider: cfg.provider,
            model:    cfg.models[cfg.provider],
          }),
        });
        const data = await res.json();
        if (!res.ok) { setAiError(data.error ?? "AI parsing failed."); setIsParsingAI(false); return; }
        onAiParsed(data as AIParsedResult);
      } catch {
        setAiError("Network error. Please try again.");
        setIsParsingAI(false);
      }
      return;
    }
    onStart();
  };

  const hasInstructions = instructions.trim().length > 0;
  const canUseAI        = hasInstructions && !!activeKey;
  const buttonMode      = csvText ? "csv" : canUseAI ? "ai" : "default";

  return (
    <div
      className="absolute inset-0 z-[100] flex items-center justify-center bg-[#F8FAFC]"
      style={{ backgroundImage: "radial-gradient(#CBD5E1 1px, transparent 1px)", backgroundSize: "30px 30px" }}
    >
      <div className="bg-white/90 backdrop-blur-md border border-gray-100 w-full max-w-2xl rounded-3xl shadow-[0_20px_60px_-15px_rgba(0,0,0,0.12)] flex flex-col overflow-hidden">

        {/* ── Header ───────────────────────────────────────────────────────── */}
        <div className="px-10 pt-9 pb-6 flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 tracking-tight flex items-center gap-3">
              <Zap className="w-8 h-8 text-indigo-600" />
              Ecosystem Data Engine
            </h1>
            <p className="text-gray-500 mt-1.5 text-sm">
              Start a new workflow, generate one with AI, or load an existing CSV export.
            </p>
          </div>

          {/* Gear + active model indicator */}
          <div className="flex items-center gap-2 mt-1 shrink-0">
            {/* Active model / key status pill */}
            {activeKey ? (
              <span className="text-xs flex items-center gap-1.5 text-slate-500">
                <span className={`w-2 h-2 rounded-full ${DOT[activeProvider]}`} />
                {activeMeta.name} · {activeModelLabel}
              </span>
            ) : (
              <span className="text-xs flex items-center gap-1 text-amber-600">
                <AlertCircle className="w-3 h-3" />
                No API key
              </span>
            )}

            {/* Settings gear */}
            <button
              onClick={onOpenSettings}
              title="AI Settings — configure provider, model and API key"
              className="p-2 rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-800 hover:border-slate-300 transition-colors"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="px-10 pb-9 flex flex-col gap-5">

          {/* ── Quick-start options ───────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-4">
            <button
              onClick={onStart}
              className="flex flex-col items-center justify-center gap-3 p-5 rounded-2xl border-2 border-slate-200 hover:border-indigo-500 hover:bg-indigo-50/40 transition-all text-center group"
            >
              <div className="w-11 h-11 rounded-full bg-indigo-100 flex items-center justify-center group-hover:bg-indigo-600 transition-colors">
                <Zap className="w-5 h-5 text-indigo-600 group-hover:text-white transition-colors" />
              </div>
              <div>
                <div className="font-bold text-slate-800 text-sm">Start Fresh</div>
                <div className="text-xs text-slate-500 mt-0.5">Load the default Ridgeview workflow</div>
              </div>
            </button>

            <div
              className="flex flex-col items-center justify-center gap-3 p-5 rounded-2xl border-2 border-slate-200 hover:border-emerald-500 hover:bg-emerald-50/40 transition-all text-center group cursor-pointer"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleFileDrop}
            >
              <div className={`w-11 h-11 rounded-full flex items-center justify-center transition-colors ${fileName ? "bg-emerald-100" : "bg-slate-100 group-hover:bg-emerald-500"}`}>
                {fileName
                  ? <FileText className="w-5 h-5 text-emerald-600" />
                  : <UploadCloud className="w-5 h-5 text-slate-500 group-hover:text-white transition-colors" />}
              </div>
              <div>
                <div className={`font-bold text-sm ${fileName ? "text-emerald-700" : "text-slate-800"}`}>
                  {fileName ? "CSV Loaded ✓" : "Import from CSV"}
                </div>
                <div className="text-xs text-slate-500 mt-0.5">
                  {fileName ? fileName : "Drag & drop or click to browse"}
                </div>
              </div>
            </div>
          </div>

          <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFileChange} />

          {/* ── AI prompt ────────────────────────────────────────────────── */}
          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
              Or describe your workflow in plain English
            </label>
            <textarea
              rows={3}
              value={instructions}
              onChange={(e) => { setInstructions(e.target.value); setAiError(null); }}
              disabled={isParsingAI}
              className={`w-full bg-white border rounded-xl p-4 text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-1 resize-none shadow-sm transition-colors disabled:opacity-60 ${
                canUseAI
                  ? "border-indigo-300 focus:border-indigo-600 focus:ring-indigo-600"
                  : "border-gray-300 focus:border-indigo-600 focus:ring-indigo-600"
              }`}
              placeholder="e.g., Xingye gets input from NAV back office, uses a script to parse data, then Mary reviews it before it goes to the Dashboard…"
            />
            {hasInstructions && !activeKey && (
              <p className="text-xs text-amber-600 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                Add an API key in AI Settings (⚙) to generate from this description.
              </p>
            )}
            {aiError && (
              <p className="text-xs text-red-600 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                {aiError}
              </p>
            )}
          </div>

          {/* ── CTA ──────────────────────────────────────────────────────── */}
          <button
            onClick={handleLoadWorkflow}
            disabled={isParsingAI}
            className={`w-full font-bold py-4 rounded-xl shadow-lg transition-all flex justify-center items-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed ${
              buttonMode === "csv"
                ? "bg-emerald-600 hover:bg-emerald-500 text-white shadow-[0_4px_14px_0_rgba(16,185,129,0.39)]"
                : "bg-indigo-600 hover:bg-indigo-500 text-white shadow-[0_4px_14px_0_rgba(79,70,229,0.39)]"
            }`}
          >
            {isParsingAI ? (
              <><Loader2 className="w-5 h-5 animate-spin" />Generating workflow with AI…</>
            ) : buttonMode === "csv" ? (
              <>Load Workflow from CSV <ArrowRight className="w-5 h-5" /></>
            ) : buttonMode === "ai" ? (
              <><Sparkles className="w-5 h-5" />Generate with AI <ArrowRight className="w-5 h-5" /></>
            ) : (
              <>Generate Ecosystem Model <ArrowRight className="w-5 h-5" /></>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
