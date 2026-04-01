"use client";
import { useRef, useState } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  Zap, ArrowRight, UploadCloud, FileText,
  Sparkles, Loader2, AlertCircle, Settings,
  ArrowLeft, Layers,
} from "lucide-react";
import type { CustomNodeConfig, CustomEdgeConfig } from "@/lib/serverState";
import type { AIConfig } from "@/components/AISettingsModal";
import { PROVIDERS, type AIProvider } from "@/lib/aiClient";
import { TEMPLATES, buildTemplateState, type Template } from "@/lib/templates";

// Dot colour per provider
const MAX_PROMPT_CHARS = 8000;

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
  metadataOverrides?: Record<string, { summary?: string; constraints?: string }>;
  workflowGroups?:    Array<{ id: string; name: string; color: string; nodeIds: string[] }>;
  settings?:          { hiddenCoreNodes?: string[] };
}

export interface AIDebugLog {
  prompt: string;
  rawAIResponse: string;
  error?: string;
  /** Which engine produced this result */
  engine?: 'monolithic' | 'distributed';
  /** Token usage from the primary AI call */
  tokenUsage?: { inputTokens: number; outputTokens: number } | null;
}

interface StartScreenProps {
  onStart:           () => void;
  onImportAndStart?: (csvText: string) => void;
  onAiParsed?:       (result: AIParsedResult) => void;
  onTemplateLoad?:   (result: AIParsedResult) => void;
  onDebugLog?:       (log: AIDebugLog) => void;
  aiConfig?:         AIConfig;
  onSaveConfig?:     (config: AIConfig) => void;
  onOpenSettings?:   () => void;
  /**
   * Track 15a — called the moment the user clicks "Generate with AI",
   * BEFORE the AI call starts. Page transitions to canvas immediately.
   */
  onGenerationStart?: () => void;
  /** Track 15a — called if AI generation fails, so the page shows the error overlay */
  onGenerationError?: (error: string) => void;
}

// ── Mini network preview SVGs per template ────────────────────────────────────

function PreviewFew() {
  // 7 nodes in a left-to-right pipeline (like Ridgeview baseline)
  const nodes = [
    [12, 40], [36, 20], [36, 60], [60, 40], [84, 40], [108, 25], [132, 40],
  ];
  const edges = [[0,1],[0,2],[0,3],[1,3],[2,3],[3,4],[4,5],[5,6],[4,6]];
  return (
    <svg viewBox="0 0 144 80" className="w-full h-full" style={{ opacity: 0.85 }}>
      {edges.map(([a, b], i) => (
        <line key={i}
          x1={nodes[a][0]} y1={nodes[a][1]} x2={nodes[b][0]} y2={nodes[b][1]}
          stroke="#94A3B8" strokeWidth="1.5" />
      ))}
      {nodes.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={i === 3 ? 7 : 5}
          fill={i === 3 ? "#4F46E5" : i === 5 ? "#F59E0B" : "#CBD5E1"}
          stroke="white" strokeWidth="1.5" />
      ))}
    </svg>
  );
}

function PreviewSome() {
  // 14 nodes in a radial pattern — PM at center, spokes outward
  const cx = 72, cy = 40;
  const ring1 = Array.from({ length: 7 }, (_, i) => {
    const a = (i / 7) * Math.PI * 2 - Math.PI / 2;
    return [cx + 22 * Math.cos(a), cy + 22 * Math.sin(a)];
  });
  const ring2 = Array.from({ length: 6 }, (_, i) => {
    const a = (i / 6) * Math.PI * 2 - Math.PI / 2 + 0.2;
    return [cx + 36 * Math.cos(a), cy + 36 * Math.sin(a)];
  });
  const allRing = [...ring1, ...ring2];
  return (
    <svg viewBox="0 0 144 80" className="w-full h-full" style={{ opacity: 0.85 }}>
      {ring1.map(([x, y], i) => (
        <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="#818CF8" strokeWidth="1.5" opacity="0.6" />
      ))}
      {ring2.map(([x, y], i) => (
        <line key={i} x1={ring1[i % ring1.length][0]} y1={ring1[i % ring1.length][1]}
          x2={x} y2={y} stroke="#94A3B8" strokeWidth="1" opacity="0.5" />
      ))}
      {allRing.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={3.5} fill={i < 7 ? "#818CF8" : "#CBD5E1"} stroke="white" strokeWidth="1" />
      ))}
      <circle cx={cx} cy={cy} r={7} fill="#4F46E5" stroke="white" strokeWidth="1.5" />
    </svg>
  );
}

function PreviewMany() {
  // 22 nodes in 4 concentric rings
  const cx = 72, cy = 40;
  const rings = [
    { r: 0,  n: 1,  fill: "#4F46E5" },
    { r: 14, n: 8,  fill: "#6366F1" },
    { r: 26, n: 8,  fill: "#818CF8" },
    { r: 36, n: 5,  fill: "#CBD5E1" },
  ];
  const allNodes: [number, number, string][] = [];
  for (const { r, n, fill } of rings) {
    for (let i = 0; i < n; i++) {
      const a = r === 0 ? 0 : (i / n) * Math.PI * 2 - Math.PI / 2;
      allNodes.push([cx + r * Math.cos(a), cy + r * Math.sin(a), fill]);
    }
  }
  return (
    <svg viewBox="0 0 144 80" className="w-full h-full" style={{ opacity: 0.85 }}>
      {/* Bundle arcs from center to ring 1 */}
      {allNodes.slice(1, 9).map(([x, y], i) => (
        <line key={`l1-${i}`} x1={cx} y1={cy} x2={x} y2={y}
          stroke="#4F46E5" strokeWidth="1.2" opacity="0.35" />
      ))}
      {/* Edges ring1→ring2 */}
      {allNodes.slice(9, 17).map(([x, y], i) => (
        <line key={`l2-${i}`}
          x1={allNodes[1 + (i % 8)][0]} y1={allNodes[1 + (i % 8)][1]}
          x2={x} y2={y}
          stroke="#818CF8" strokeWidth="1" opacity="0.3" />
      ))}
      {/* Edges ring2→ring3 */}
      {allNodes.slice(17).map(([x, y], i) => (
        <line key={`l3-${i}`}
          x1={allNodes[9 + (i % 8)][0]} y1={allNodes[9 + (i % 8)][1]}
          x2={x} y2={y}
          stroke="#94A3B8" strokeWidth="1" opacity="0.3" />
      ))}
      {allNodes.map(([x, y, fill], i) => (
        <circle key={i} cx={x} cy={y} r={i === 0 ? 6 : i < 9 ? 3.5 : 3}
          fill={fill} stroke="white" strokeWidth="1" />
      ))}
    </svg>
  );
}

function PreviewBlank() {
  return (
    <svg viewBox="0 0 144 80" className="w-full h-full" style={{ opacity: 0.6 }}>
      <rect x="4" y="4" width="136" height="72" rx="8"
        fill="none" stroke="#CBD5E1" strokeWidth="1.5" strokeDasharray="6 4" />
      <text x="72" y="38" textAnchor="middle" fontSize="11" fill="#94A3B8" fontFamily="system-ui">
        Your canvas
      </text>
      <text x="72" y="52" textAnchor="middle" fontSize="10" fill="#CBD5E1" fontFamily="system-ui">
        starts empty
      </text>
    </svg>
  );
}

// ── Density badge ─────────────────────────────────────────────────────────────

// DENSITY_STYLE labels are looked up dynamically via t() in TemplateCard
const DENSITY_STYLE: Record<Template["density"], { bg: string; text: string }> = {
  few:  { bg: "bg-indigo-100", text: "text-indigo-700"  },
  some: { bg: "bg-violet-100", text: "text-violet-700"  },
  many: { bg: "bg-emerald-100",text: "text-emerald-700" },
};

// ── Template card ─────────────────────────────────────────────────────────────

function TemplateCard({
  template,
  preview,
  onSelect,
}: {
  template: Template;
  preview:  React.ReactNode;
  onSelect: (t: Template) => void;
}) {
  const { t } = useLanguage();
  const ds = DENSITY_STYLE[template.density];
  const densityKey = template.density === 'few'
    ? 'gallery.density.few'
    : template.density === 'some'
    ? 'gallery.density.some'
    : 'gallery.density.many';
  return (
    <button
      onClick={() => onSelect(template)}
      className="group flex flex-col gap-0 rounded-2xl border-2 border-slate-200 hover:border-indigo-500 hover:shadow-[0_0_0_4px_rgba(99,102,241,0.08)] bg-white text-left overflow-hidden transition-all duration-150"
    >
      {/* Mini preview pane */}
      <div className="w-full h-28 bg-slate-50 flex items-center justify-center px-6 py-3 border-b border-slate-100 group-hover:bg-indigo-50/40 transition-colors">
        {preview}
      </div>

      {/* Info */}
      <div className="px-5 py-4 flex flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <span className="font-bold text-slate-800 text-sm leading-snug group-hover:text-indigo-700 transition-colors">
            {t(`template.${template.id}.name` as any) || template.name}
          </span>
          <span className={`shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full ${ds.bg} ${ds.text}`}>
            {t(densityKey as any)}
          </span>
        </div>
        <p className="text-xs text-slate-500 leading-relaxed">
          {t(`template.${template.id}.desc` as any) || template.description}
        </p>
        {template.nodeCount > 0 && (
          <p className="text-[11px] text-slate-400 font-mono">
            {template.nodeCount} nodes · {template.edgeCount} edges
          </p>
        )}
      </div>
    </button>
  );
}

// ── Template preview map (static — defined outside component to avoid recreation) ──

const TEMPLATE_PREVIEWS: Record<string, React.ReactNode> = {
  blank:              <PreviewBlank />,
  "morning-routine":  <PreviewFew />,
  "project-workflow": <PreviewSome />,
  "full-week":        <PreviewMany />,
};

// ── Template gallery overlay ──────────────────────────────────────────────────

function TemplateGallery({
  onSelect,
  onBack,
}: {
  onSelect: (t: Template) => void;
  onBack:   () => void;
}) {
  const { t } = useLanguage();

  return (
    <div className="absolute inset-0 z-[110] flex items-center justify-center bg-[#F8FAFC]"
      style={{ backgroundImage: "radial-gradient(#CBD5E1 1px, transparent 1px)", backgroundSize: "30px 30px" }}
    >
      <div className="bg-white/95 backdrop-blur-md border border-gray-100 w-full max-w-3xl rounded-3xl shadow-[0_20px_60px_-15px_rgba(0,0,0,0.14)] flex flex-col overflow-hidden max-h-[90vh]">

        {/* Header */}
        <div className="px-8 pt-7 pb-5 flex items-center gap-4 border-b border-slate-100">
          <button
            onClick={onBack}
            className="p-2 rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-800 transition-colors shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h2 className="text-xl font-bold text-slate-900 tracking-tight">{t('gallery.title')}</h2>
            <p className="text-sm text-slate-500 mt-0.5">
              {t('gallery.desc')}
            </p>
          </div>
        </div>

        {/* Legend strip */}
        <div className="px-8 py-3 bg-slate-50/60 border-b border-slate-100 flex items-center gap-6 text-xs text-slate-500">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-indigo-200 inline-block" />
            <span className="text-indigo-600 font-semibold">{t('gallery.legend.few')}</span> {t('gallery.legend.few.desc')}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-violet-200 inline-block" />
            <span className="text-violet-600 font-semibold">{t('gallery.legend.some')}</span> {t('gallery.legend.some.desc')}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-200 inline-block" />
            <span className="text-emerald-600 font-semibold">{t('gallery.legend.many')}</span> {t('gallery.legend.many.desc')}
          </span>
        </div>

        {/* Card grid */}
        <div className="p-8 grid grid-cols-2 gap-4 overflow-y-auto">
          {TEMPLATES.map((t) => (
            <TemplateCard
              key={t.id}
              template={t}
              preview={TEMPLATE_PREVIEWS[t.id] ?? <PreviewFew />}
              onSelect={onSelect}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main StartScreen component ────────────────────────────────────────────────

export function StartScreen({
  onStart, onImportAndStart, onAiParsed, onTemplateLoad, onDebugLog,
  aiConfig, onSaveConfig: _onSaveConfig, onOpenSettings,
  onGenerationStart, onGenerationError,
}: StartScreenProps) {
  const { t, lang } = useLanguage();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName]         = useState<string | null>(null);
  const [csvText, setCsvText]           = useState<string | null>(null);
  const [instructions, setInstructions] = useState("");
  const [isParsingAI, setIsParsingAI]   = useState(false);
  const [aiError, setAiError]           = useState<string | null>(null);
  const [showGallery, setShowGallery]   = useState(false);

  const cfg            = aiConfig;
  const activeProvider = cfg?.provider ?? "anthropic";
  const activeKey      = cfg?.keys?.[activeProvider]?.trim() ?? "";
  const activeMeta     = PROVIDERS.find((p) => p.id === activeProvider)!;
  const activeModel    = cfg?.models?.[activeProvider] ?? activeMeta.defaultModel;
  const activeModelLabel = activeMeta.usesEndpointId
    ? (activeModel || "no endpoint set")
    : (activeMeta.models.find((m) => m.id === activeModel)?.label ?? activeModel);

  // ── File handling ────────────────────────────────────────────────────────
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

  // ── Template selection ───────────────────────────────────────────────────
  // Always go through onTemplateLoad so the server state is reset correctly,
  // even when switching back to Ridgeview from another template.
  const handleTemplateSelect = (template: Template) => {
    const state = buildTemplateState(template, lang);
    if (onTemplateLoad) {
      onTemplateLoad({
        customNodes:        state.customNodes,
        customEdges:        state.customEdges,
        baselinePositions:  state.baselinePositions,
        ecosystemPositions: state.ecosystemPositions,
        settings:           state.settings,
      });
    } else {
      onStart();
    }
  };

  // ── Primary action ───────────────────────────────────────────────────────
  const handleLoadWorkflow = async () => {
    setAiError(null);
    if (csvText && onImportAndStart) { onImportAndStart(csvText); return; }
    if (instructions.trim() && activeKey && cfg && onAiParsed) {
      setIsParsingAI(true);

      // Track 15a: Transition to canvas shell immediately — don't wait for the AI call.
      // The page shows the WorkflowGeneratingOverlay while the fetch is in flight.
      onGenerationStart?.();

      try {
        const sentPrompt = instructions.trim();
        const res = await fetch("/api/ai/parse-workflow", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt:   sentPrompt,
            apiKey:   activeKey,
            provider: cfg.provider,
            model:    cfg.models[cfg.provider],
            baseUrl:  cfg.baseUrls?.[cfg.provider] || undefined,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          const errMsg = data.error ?? "AI parsing failed.";
          onDebugLog?.({ prompt: sentPrompt, rawAIResponse: data.rawAIResponse ?? '', error: errMsg });
          // Propagate error to page overlay (stays on canvas with error card)
          if (onGenerationError) {
            onGenerationError(errMsg);
          } else {
            setAiError(errMsg);
          }
          setIsParsingAI(false);
          return;
        }
        onDebugLog?.({ prompt: sentPrompt, rawAIResponse: data.rawAIResponse ?? '' });
        onAiParsed(data as AIParsedResult);
      } catch {
        const errMsg = "Network error. Please try again.";
        if (onGenerationError) {
          onGenerationError(errMsg);
        } else {
          setAiError(errMsg);
        }
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
    <>
      {/* ── Template gallery overlay ─────────────────────────────────── */}
      {showGallery && (
        <TemplateGallery
          onSelect={handleTemplateSelect}
          onBack={() => setShowGallery(false)}
        />
      )}

      {/* ── Main start screen ─────────────────────────────────────────── */}
      <div
        className="absolute inset-0 z-[100] flex items-center justify-center bg-[#F8FAFC]"
        style={{ backgroundImage: "radial-gradient(#CBD5E1 1px, transparent 1px)", backgroundSize: "30px 30px" }}
      >
        <div className="bg-white/90 backdrop-blur-md border border-gray-100 w-full max-w-2xl rounded-3xl shadow-[0_20px_60px_-15px_rgba(0,0,0,0.12)] flex flex-col overflow-hidden">

          {/* Header */}
          <div className="px-10 pt-9 pb-6 flex items-start justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 tracking-tight flex items-center gap-3">
                <img src="/workable-logo.svg" alt="Workable" className="w-9 h-9" />
                {t('startScreen.title')}
              </h1>
              <p className="text-gray-500 mt-1.5 text-sm">
                {t('startScreen.desc')}
              </p>
            </div>

            {/* Active model / settings */}
            <div className="flex items-center gap-2 mt-1 shrink-0">
              {activeKey ? (
                <span className="text-xs flex items-center gap-1.5 text-slate-500">
                  <span className={`w-2 h-2 rounded-full ${DOT[activeProvider]}`} />
                  {activeMeta.name} · {activeModelLabel}
                </span>
              ) : (
                <span className="text-xs flex items-center gap-1 text-amber-600">
                  <AlertCircle className="w-3 h-3" />
                  {t('startScreen.noApiKey')}
                </span>
              )}
              <button
                onClick={onOpenSettings}
                title={t('settings.title')}
                className="p-2 rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-800 hover:border-slate-300 transition-colors"
              >
                <Settings className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="px-10 pb-9 flex flex-col gap-5">

            {/* Quick-start options */}
            <div className="grid grid-cols-2 gap-4">

              {/* Start Fresh → opens template gallery */}
              <button
                onClick={() => setShowGallery(true)}
                className="flex flex-col items-center justify-center gap-3 p-5 rounded-2xl border-2 border-slate-200 hover:border-indigo-500 hover:bg-indigo-50/40 transition-all text-center group"
              >
                <div className="w-11 h-11 rounded-full bg-indigo-100 flex items-center justify-center group-hover:bg-indigo-600 transition-colors">
                  <Layers className="w-5 h-5 text-indigo-600 group-hover:text-white transition-colors" />
                </div>
                <div>
                  <div className="font-bold text-slate-800 text-sm">{t('startScreen.startFresh')}</div>
                  <div className="text-xs text-slate-500 mt-0.5">{t('startScreen.startFresh.desc')}</div>
                </div>
              </button>

              {/* Import from CSV */}
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
                    {fileName ? t('startScreen.csvLoaded') : t('startScreen.importCsv')}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {fileName ? fileName : t('startScreen.csvDrag')}
                  </div>
                </div>
              </div>
            </div>

            <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFileChange} />

            {/* AI prompt */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
                {t('startScreen.promptLabel')}
              </label>
              <textarea
                rows={3}
                value={instructions}
                onChange={(e) => {
                  if (e.target.value.length <= MAX_PROMPT_CHARS) {
                    setInstructions(e.target.value);
                    setAiError(null);
                  }
                }}
                disabled={isParsingAI}
                className={`w-full bg-white border rounded-xl p-4 text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-1 resize-none shadow-sm transition-colors disabled:opacity-60 ${
                  canUseAI
                    ? "border-indigo-300 focus:border-indigo-600 focus:ring-indigo-600"
                    : "border-gray-300 focus:border-indigo-600 focus:ring-indigo-600"
                }`}
                placeholder={t('startScreen.placeholder')}
              />
              {/* Token counter */}
              <div className={`text-xs text-right tabular-nums ${
                instructions.length >= MAX_PROMPT_CHARS ? "text-red-500 font-medium" : "text-slate-400"
              }`}>
                {instructions.length.toLocaleString()}&thinsp;/&thinsp;{MAX_PROMPT_CHARS.toLocaleString()}
              </div>
              {hasInstructions && !activeKey && (
                <p className="text-xs text-amber-600 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" />
                  {t('startScreen.noKeyHint')}
                </p>
              )}
              {aiError && (
                <p className="text-xs text-red-600 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" />
                  {aiError}
                </p>
              )}
            </div>

            {/* CTA */}
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
                <><Loader2 className="w-5 h-5 animate-spin" />{t('startScreen.btnGenerating')}</>
              ) : buttonMode === "csv" ? (
                <>{t('startScreen.btnCsv')} <ArrowRight className="w-5 h-5" /></>
              ) : buttonMode === "ai" ? (
                <><Sparkles className="w-5 h-5" />{t('startScreen.btnAi')} <ArrowRight className="w-5 h-5" /></>
              ) : (
                <>{t('startScreen.btnDefault')} <ArrowRight className="w-5 h-5" /></>
              )}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
