"use client";

import { useState, useEffect } from "react";
import {
  X, Sparkles, Loader2, AlertCircle, Plus, Trash2, Check,
  RefreshCw, Info, AlertTriangle, ShieldAlert, Zap, CheckCircle2,
} from "lucide-react";

export interface SuggestedConnection {
  sourceId: string;
  sourceName: string;
  targetId: string;
  targetName: string;
  connectionName: string;
  connectionType?: string;
  reason: string;
}

export interface SuggestedRemoval {
  type: "node" | "edge";
  id: string;
  name: string;
  action: "remove" | "automate" | "merge";
  reason: string;
}

interface AIAnalysisModalProps {
  isOpen: boolean;
  isLoading: boolean;
  analysis: string | null;
  suggestedConnections?: SuggestedConnection[];
  suggestedRemovals?: SuggestedRemoval[];
  error: string | null;
  onClose: () => void;
  onAddConnection?: (conn: SuggestedConnection) => void;
  onRemoveEntity?: (removal: SuggestedRemoval) => void;
  /** Callback to trigger a fresh analysis (clears existing result) */
  onReAnalyze?: () => void;
  /** Unix ms timestamp when the cached analysis was generated */
  analysisTimestamp?: number | null;
}

// ─── Section config ──────────────────────────────────────────────────────────

interface SectionConfig {
  key: string;
  title: string;
  icon: React.ReactNode;
  bg: string;
  border: string;
  iconBg: string;
  titleColor: string;
  dotColor: string;
}

const SECTION_CONFIGS: SectionConfig[] = [
  {
    key: "workflow summary",
    title: "Workflow Summary",
    icon: <Info className="w-3.5 h-3.5 text-indigo-600" />,
    bg: "bg-indigo-50/60",
    border: "border-indigo-100",
    iconBg: "bg-indigo-100",
    titleColor: "text-indigo-700",
    dotColor: "bg-indigo-400",
  },
  {
    key: "bottlenecks identified",
    title: "Bottlenecks Identified",
    icon: <AlertTriangle className="w-3.5 h-3.5 text-red-500" />,
    bg: "bg-red-50/60",
    border: "border-red-100",
    iconBg: "bg-red-100",
    titleColor: "text-red-700",
    dotColor: "bg-red-400",
  },
  {
    key: "constraint analysis",
    title: "Constraint Analysis",
    icon: <ShieldAlert className="w-3.5 h-3.5 text-amber-600" />,
    bg: "bg-amber-50/60",
    border: "border-amber-100",
    iconBg: "bg-amber-100",
    titleColor: "text-amber-700",
    dotColor: "bg-amber-400",
  },
  {
    key: "quick wins",
    title: "Quick Wins",
    icon: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />,
    bg: "bg-emerald-50/60",
    border: "border-emerald-100",
    iconBg: "bg-emerald-100",
    titleColor: "text-emerald-700",
    dotColor: "bg-emerald-400",
  },
  {
    key: "recommendations",
    title: "Recommendations",
    icon: <Zap className="w-3.5 h-3.5 text-violet-600" />,
    bg: "bg-violet-50/60",
    border: "border-violet-100",
    iconBg: "bg-violet-100",
    titleColor: "text-violet-700",
    dotColor: "bg-violet-400",
  },
];

function getSectionConfig(title: string): SectionConfig {
  const key = title.toLowerCase().trim();
  return (
    SECTION_CONFIGS.find(s => key.includes(s.key)) ?? {
      key,
      title,
      icon: <Info className="w-3.5 h-3.5 text-slate-500" />,
      bg: "bg-slate-50/60",
      border: "border-slate-100",
      iconBg: "bg-slate-100",
      titleColor: "text-slate-700",
      dotColor: "bg-slate-400",
    }
  );
}

// ─── Parser ───────────────────────────────────────────────────────────────────

interface ParsedSection {
  title: string;
  items: string[];
  config: SectionConfig;
}

function parseAnalysis(text: string): ParsedSection[] {
  const sections: ParsedSection[] = [];
  let currentTitle = "";
  let currentItems: string[] = [];

  const flush = () => {
    if (currentTitle && currentItems.length > 0) {
      sections.push({
        title:  currentTitle,
        items:  currentItems.filter(i => i.trim()),
        config: getSectionConfig(currentTitle),
      });
    }
    currentItems = [];
  };

  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("## ")) {
      flush();
      currentTitle = line.slice(3).trim();
    } else if (line.startsWith("- ") || line.startsWith("• ")) {
      currentItems.push(line.slice(2).trim());
    } else if (/^\d+\.\s/.test(line)) {
      currentItems.push(line.replace(/^\d+\.\s/, "").trim());
    } else if (line && !line.startsWith("#")) {
      // Non-header, non-bullet paragraph — add as item if we have a section
      if (currentTitle) currentItems.push(line);
    }
  }
  flush();

  return sections;
}

// ─── Relative time helper ─────────────────────────────────────────────────────

function useRelativeTime(timestamp: number | null | undefined) {
  const [label, setLabel] = useState("");

  useEffect(() => {
    if (!timestamp) { setLabel(""); return; }
    const update = () => {
      const secs = Math.floor((Date.now() - timestamp) / 1000);
      if (secs < 60)          setLabel(`${secs}s ago`);
      else if (secs < 3600)   setLabel(`${Math.floor(secs / 60)}m ago`);
      else                    setLabel(`${Math.floor(secs / 3600)}h ago`);
    };
    update();
    const t = setInterval(update, 15_000);
    return () => clearInterval(t);
  }, [timestamp]);

  return label;
}

// ─── Action helpers ───────────────────────────────────────────────────────────

const ACTION_LABEL: Record<string, string> = {
  remove:   "Remove",
  automate: "Automate",
  merge:    "Merge",
};
const ACTION_DONE_LABEL: Record<string, string> = {
  remove:   "Removed",
  automate: "Automated",
  merge:    "Merged",
};
const ACTION_COLOR: Record<string, string> = {
  remove:   "bg-red-50 text-red-600 border-red-200 hover:bg-red-100",
  automate: "bg-amber-50 text-amber-600 border-amber-200 hover:bg-amber-100",
  merge:    "bg-violet-50 text-violet-600 border-violet-200 hover:bg-violet-100",
};

// ─── Main component ───────────────────────────────────────────────────────────

export function AIAnalysisModal({
  isOpen, isLoading, analysis, suggestedConnections = [], suggestedRemovals = [],
  error, onClose, onAddConnection, onRemoveEntity, onReAnalyze, analysisTimestamp,
}: AIAnalysisModalProps) {
  const timeLabel = useRelativeTime(analysisTimestamp);
  const [appliedConnections, setAppliedConnections] = useState<Set<number>>(new Set());
  const [appliedRemovals,    setAppliedRemovals]    = useState<Set<number>>(new Set());

  if (!isOpen) return null;

  const sections         = analysis ? parseAnalysis(analysis) : [];
  const hasSuggestions   = (suggestedConnections.length > 0 || suggestedRemovals.length > 0) && !isLoading && !error;
  const isCachedResult   = !!analysis && !isLoading && !!analysisTimestamp;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[88vh] flex flex-col relative border border-slate-100">

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-8 pt-7 pb-5 border-b border-slate-100 flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0">
              <Sparkles className="w-4 h-4 text-indigo-600" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-bold text-slate-800">AI Workflow Analysis</h2>
              <div className="flex items-center gap-2">
                <p className="text-xs text-slate-500">Powered by AI · click suggestions to apply</p>
                {isCachedResult && timeLabel && (
                  <span className="text-[10px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-full font-medium">
                    {timeLabel}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Re-analyze button — only shown when a cached result exists */}
            {isCachedResult && onReAnalyze && (
              <button
                onClick={onReAnalyze}
                title="Run a fresh analysis"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-indigo-200 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 text-xs font-semibold transition-colors"
              >
                <RefreshCw className="w-3 h-3" />
                Re-analyze
              </button>
            )}
            <button onClick={onClose}
              className="p-1.5 rounded-full hover:bg-slate-100 transition-colors text-slate-400 hover:text-slate-700">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ── Body ── */}
        <div className="flex-1 overflow-y-auto px-8 py-6 space-y-4">

          {/* Loading */}
          {isLoading && (
            <div className="flex flex-col items-center justify-center gap-3 py-14 text-slate-500">
              <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
              <p className="text-sm font-medium">Analyzing your workflow…</p>
              <p className="text-xs text-slate-400">This may take a few seconds</p>
            </div>
          )}

          {/* Error */}
          {error && !isLoading && (
            <div className="flex items-start gap-3 p-4 rounded-xl bg-red-50 border border-red-100">
              <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-red-700 mb-0.5">Analysis failed</p>
                <p className="text-sm text-red-600">{error}</p>
                {onReAnalyze && (
                  <button
                    onClick={onReAnalyze}
                    className="mt-2 flex items-center gap-1 text-xs font-semibold text-red-600 hover:text-red-700 underline"
                  >
                    <RefreshCw className="w-3 h-3" /> Try again
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ── Section cards ── */}
          {!isLoading && sections.length > 0 && (
            <div className="space-y-3">
              {sections.map((section) => (
                <div
                  key={section.title}
                  className={`rounded-2xl border p-5 ${section.config.bg} ${section.config.border}`}
                >
                  {/* Section header */}
                  <div className="flex items-center gap-2.5 mb-3">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${section.config.iconBg}`}>
                      {section.config.icon}
                    </div>
                    <h3 className={`text-sm font-bold ${section.config.titleColor}`}>
                      {section.title}
                    </h3>
                  </div>

                  {/* Bullet points */}
                  <ul className="space-y-2">
                    {section.items.map((item, idx) => (
                      <li key={idx} className="flex items-start gap-2.5">
                        <span className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${section.config.dotColor}`} />
                        <span className="text-sm text-slate-700 leading-relaxed">{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}

          {/* Fallback: raw text if no sections parsed */}
          {!isLoading && analysis && sections.length === 0 && (
            <div className="rounded-2xl border border-slate-100 bg-slate-50/60 p-5">
              <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{analysis}</p>
            </div>
          )}

          {/* ── Suggested Connections ── */}
          {hasSuggestions && suggestedConnections.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3 mt-2">
                <div className="w-5 h-5 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
                  <Plus className="w-3 h-3 text-emerald-600" />
                </div>
                <h3 className="text-sm font-bold text-slate-800">Suggested Connections</h3>
                <span className="text-xs text-slate-400">— new routes to add</span>
              </div>
              <div className="space-y-2">
                {suggestedConnections.map((conn, i) => {
                  const isApplied = appliedConnections.has(i);
                  return (
                  <div key={i}
                    className={`flex items-start justify-between gap-3 p-4 rounded-xl border transition-colors ${
                      isApplied ? "border-slate-200 bg-slate-50/60" : "border-emerald-100 bg-emerald-50/40"
                    }`}>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-700 mb-1 flex-wrap">
                        <span className={`truncate max-w-[130px] ${isApplied ? "text-slate-400" : "text-emerald-600"}`}>{conn.sourceName}</span>
                        <span className="text-slate-400 text-xs flex-shrink-0">→</span>
                        <span className={`truncate max-w-[130px] ${isApplied ? "text-slate-400" : "text-emerald-600"}`}>{conn.targetName}</span>
                        {conn.connectionName && (
                          <span className="text-[10px] font-medium text-slate-500 bg-white border border-slate-200 px-1.5 py-0.5 rounded-full flex-shrink-0 ml-1">
                            {conn.connectionName}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 leading-relaxed">{conn.reason}</p>
                    </div>
                    {onAddConnection && (
                      isApplied ? (
                        <span className="flex-shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-100 text-slate-400 text-xs font-semibold cursor-default">
                          <Check className="w-3 h-3" /> Added
                        </span>
                      ) : (
                        <button
                          onClick={() => { onAddConnection(conn); setAppliedConnections(s => new Set([...s, i])); }}
                          className="flex-shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-semibold transition-colors"
                        >
                          <Plus className="w-3 h-3" /> Add
                        </button>
                      )
                    )}
                  </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Suggested Removals ── */}
          {hasSuggestions && suggestedRemovals.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-5 h-5 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                  <AlertTriangle className="w-3 h-3 text-red-500" />
                </div>
                <h3 className="text-sm font-bold text-slate-800">Suggested Changes</h3>
                <span className="text-xs text-slate-400">— entities to remove or automate</span>
              </div>
              <div className="space-y-2">
                {suggestedRemovals.map((rem, i) => {
                  const isApplied = appliedRemovals.has(i);
                  return (
                  <div key={i}
                    className={`flex items-start justify-between gap-3 p-4 rounded-xl border transition-colors ${
                      isApplied ? "border-slate-200 bg-slate-50/40 opacity-60" : "border-slate-200 bg-slate-50/60"
                    }`}>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className={`text-sm font-semibold truncate ${isApplied ? "text-slate-400 line-through" : "text-slate-700"}`}>{rem.name}</span>
                        <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full border ${
                          isApplied ? "bg-slate-100 text-slate-400 border-slate-200" :
                          rem.action === "remove"   ? "bg-red-50 text-red-500 border-red-200" :
                          rem.action === "automate" ? "bg-amber-50 text-amber-600 border-amber-200" :
                                                      "bg-violet-50 text-violet-600 border-violet-200"
                        }`}>
                          {isApplied
                            ? (ACTION_DONE_LABEL[rem.action] ?? rem.action)
                            : (ACTION_LABEL[rem.action] ?? rem.action)}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 leading-relaxed">{rem.reason}</p>
                    </div>
                    {onRemoveEntity && (
                      isApplied ? (
                        <span className="flex-shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-100 text-slate-400 text-xs font-semibold cursor-default border border-slate-200">
                          <Check className="w-3 h-3" />
                          {ACTION_DONE_LABEL[rem.action] ?? "Applied"}
                        </span>
                      ) : (
                        <button
                          onClick={() => { onRemoveEntity(rem); setAppliedRemovals(s => new Set([...s, i])); }}
                          className={`flex-shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${
                            ACTION_COLOR[rem.action] ?? "bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200"
                          }`}
                        >
                          <Trash2 className="w-3 h-3" />
                          {ACTION_LABEL[rem.action] ?? "Apply"}
                        </button>
                      )
                    )}
                  </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="px-8 pb-6 pt-3 border-t border-slate-100 flex-shrink-0 flex items-center justify-between gap-3">
          {onReAnalyze && !isLoading && !isCachedResult && (
            <button
              onClick={onReAnalyze}
              className="flex items-center gap-1.5 text-xs text-indigo-600 hover:text-indigo-700 font-semibold"
            >
              <RefreshCw className="w-3 h-3" /> Run analysis
            </button>
          )}
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="px-6 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-sm font-semibold hover:bg-slate-50 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
