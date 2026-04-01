"use client";

import { useState, useEffect, useRef } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  X, Sparkles, Loader2, AlertCircle, Plus, Trash2, Check,
  RefreshCw, Info, AlertTriangle, ShieldAlert, Zap, CheckCircle2,
  MinusCircle, UserCog, Merge, ClipboardList, Link2Off, Layers,
} from "lucide-react";
import { useFocusTrap } from "@/hooks/useFocusTrap";

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface CascadeEffect {
  id: string;
  type: "orphan" | "bottleneck" | "stable" | "redundant-edge";
  description: string;
  depth: number;
}

export interface SuggestedConnection {
  sourceId: string;
  sourceName: string;
  targetId: string;
  targetName: string;
  connectionName: string;
  connectionType?: string;
  reason: string;
  cascadeEffects?: CascadeEffect[];
}

export interface FishboneBone {
  category: "People" | "Process" | "Technology" | "Environment";
  cause: string;
  resolvedBy?: {
    type: "connection" | "edgeRemoval" | "newNode" | "taskUpdate" | "removal" | "groupUpdate";
    refId: string;
  };
}

export interface SuggestedRemoval {
  type: "node" | "edge";
  id: string;
  name: string;
  action: "remove" | "automate" | "merge";
  reason: string;
  mergeTargetId?: string;
  fishboneBones?: FishboneBone[];
}

export interface SuggestedEdgeRemoval {
  edgeId: string;
  sourceName: string;
  targetName: string;
  reason: string;
  prerequisiteConnectionId?: string;
}

export interface SuggestedNewNode {
  tempId: string;
  label: string;
  role: string;
  summary: string;
  connectFrom: string[];
  connectTo: string[];
  replacesNodeId?: string;
}

export interface SuggestedTaskUpdate {
  nodeId: string;
  nodeName: string;
  addTasks: Array<{ id: string; title: string; status: string; priority: string }>;
  removeTasks: string[];
  reason: string;
}

export interface SuggestedGroupUpdate {
  action: "create" | "update" | "delete";
  groupId?: string;
  tempId?: string;
  currentName?: string;
  name?: string;
  color?: string;
  nodeIds?: string[];
  addNodeIds?: string[];
  removeNodeIds?: string[];
  reason: string;
}

export interface SuggestionPhase {
  phaseIndex: number;
  label: string;
  description: string;
  prerequisitePhases: number[];
  suggestionRefs: Array<{ type: string; refId: string }>;
}

interface AIAnalysisModalProps {
  isOpen: boolean;
  isLoading: boolean;
  analysis: string | null;
  /** Track 14d: partial text being streamed in — shown live before analysis finalises */
  streamText?: string;
  suggestedConnections?: SuggestedConnection[];
  suggestedEdgeRemovals?: SuggestedEdgeRemoval[];
  suggestedRemovals?: SuggestedRemoval[];
  suggestedNewNodes?: SuggestedNewNode[];
  suggestedTaskUpdates?: SuggestedTaskUpdate[];
  suggestedGroupUpdates?: SuggestedGroupUpdate[];
  suggestionPlan?: { phases: SuggestionPhase[] } | null;
  error: string | null;
  onClose: () => void;
  onAddConnection?: (conn: SuggestedConnection) => void;
  onRemoveEdge?: (removal: SuggestedEdgeRemoval) => void;
  onRemoveEntity?: (removal: SuggestedRemoval) => void | Promise<void>;
  onAddNewNode?: (node: SuggestedNewNode) => void;
  onUpdateTasks?: (update: SuggestedTaskUpdate) => void;
  onApplyGroupUpdate?: (update: SuggestedGroupUpdate) => void;
  /** Callback to trigger a fresh analysis (clears existing result) */
  onReAnalyze?: () => void;
  /** Unix ms timestamp when the cached analysis was generated */
  analysisTimestamp?: number | null;
  /** Applied connection keys from parent (sourceId-targetId) */
  appliedConnectionKeys?: Set<string>;
  /** Applied removal node IDs from parent */
  appliedRemovalIds?: Set<string>;
  /** If true, indicates this is pre-baked demo data */
  isDemo?: boolean;
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
    icon: <Info className="w-3.5 h-3.5 text-purple-600" />,
    bg: "bg-purple-50/60", border: "border-purple-100",
    iconBg: "bg-purple-100", titleColor: "text-purple-700", dotColor: "bg-purple-400",
  },
  {
    key: "bottlenecks identified",
    title: "Bottlenecks Identified",
    icon: <AlertTriangle className="w-3.5 h-3.5 text-red-500" />,
    bg: "bg-red-50/60", border: "border-red-100",
    iconBg: "bg-red-100", titleColor: "text-red-700", dotColor: "bg-red-400",
  },
  {
    key: "constraint analysis",
    title: "Constraint Analysis",
    icon: <ShieldAlert className="w-3.5 h-3.5 text-amber-600" />,
    bg: "bg-amber-50/60", border: "border-amber-100",
    iconBg: "bg-amber-100", titleColor: "text-amber-700", dotColor: "bg-amber-400",
  },
  {
    key: "quick wins",
    title: "Quick Wins",
    icon: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />,
    bg: "bg-emerald-50/60", border: "border-emerald-100",
    iconBg: "bg-emerald-100", titleColor: "text-emerald-700", dotColor: "bg-emerald-400",
  },
  {
    key: "recommendations",
    title: "Recommendations",
    icon: <Zap className="w-3.5 h-3.5 text-violet-600" />,
    bg: "bg-violet-50/60", border: "border-violet-100",
    iconBg: "bg-violet-100", titleColor: "text-violet-700", dotColor: "bg-violet-400",
  },
  {
    key: "per-node analysis",
    title: "Per-Node Analysis",
    icon: <Info className="w-3.5 h-3.5 text-sky-600" />,
    bg: "bg-sky-50/60", border: "border-sky-100",
    iconBg: "bg-sky-100", titleColor: "text-sky-700", dotColor: "bg-sky-400",
  },
  {
    key: "group analysis",
    title: "Group Analysis",
    icon: <Layers className="w-3.5 h-3.5 text-teal-600" />,
    bg: "bg-teal-50/60", border: "border-teal-100",
    iconBg: "bg-teal-100", titleColor: "text-teal-700", dotColor: "bg-teal-400",
  },
];

function getSectionConfig(title: string): SectionConfig {
  const key = title.toLowerCase().trim();
  return (
    SECTION_CONFIGS.find(s => key.includes(s.key)) ?? {
      key, title,
      icon: <Info className="w-3.5 h-3.5 text-slate-500" />,
      bg: "bg-slate-50/60", border: "border-slate-100",
      iconBg: "bg-slate-100", titleColor: "text-slate-700", dotColor: "bg-slate-400",
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
        title: currentTitle,
        items: currentItems.filter(i => i.trim()),
        config: getSectionConfig(currentTitle),
      });
    }
    currentItems = [];
  };

  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("## ")) { flush(); currentTitle = line.slice(3).trim(); }
    else if (line.startsWith("- ") || line.startsWith("• ")) currentItems.push(line.slice(2).trim());
    else if (/^\d+\.\s/.test(line)) currentItems.push(line.replace(/^\d+\.\s/, "").trim());
    else if (line && !line.startsWith("#") && currentTitle) currentItems.push(line);
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
      if (secs < 60)        setLabel(`${secs}s ago`);
      else if (secs < 3600) setLabel(`${Math.floor(secs / 60)}m ago`);
      else                  setLabel(`${Math.floor(secs / 3600)}h ago`);
    };
    update();
    const t = setInterval(update, 15_000);
    return () => clearInterval(t);
  }, [timestamp]);
  return label;
}

// ─── Action helpers ───────────────────────────────────────────────────────────

// Note: ACTION_LABEL and ACTION_DONE_LABEL are now looked up via t() inside the component
const ACTION_LABEL: Record<string, string> = {
  remove: "Remove", automate: "Automate", merge: "Merge",
};
const ACTION_DONE_LABEL: Record<string, string> = {
  remove: "Removed", automate: "Automated", merge: "Merged",
};
const ACTION_COLOR: Record<string, string> = {
  remove:   "bg-red-50 text-red-600 border-red-200 hover:bg-red-100",
  automate: "bg-amber-50 text-amber-600 border-amber-200 hover:bg-amber-100",
  merge:    "bg-violet-50 text-violet-600 border-violet-200 hover:bg-violet-100",
};
const ACTION_ICON: Record<string, React.ReactNode> = {
  remove:   <Trash2 className="w-3 h-3" />,
  automate: <UserCog className="w-3 h-3" />,
  merge:    <Merge className="w-3 h-3" />,
};

function cascadeBadgeClass(type: CascadeEffect["type"]) {
  switch (type) {
    case "orphan":        return "bg-red-50 text-red-600";
    case "bottleneck":    return "bg-amber-50 text-amber-600";
    case "redundant-edge":return "bg-orange-50 text-orange-600";
    default:              return "bg-emerald-50 text-emerald-600";
  }
}
function cascadeIcon(type: CascadeEffect["type"]) {
  switch (type) {
    case "orphan":         return <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />;
    case "bottleneck":     return <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />;
    case "redundant-edge": return <Link2Off className="w-3.5 h-3.5 text-orange-400 shrink-0 mt-0.5" />;
    default:               return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />;
  }
}

// ─── Main component ───────────────────────────────────────────────────────────

export function AIAnalysisModal({
  isOpen, isLoading, analysis, streamText = '',
  suggestedConnections = [], suggestedEdgeRemovals = [],
  suggestedRemovals = [], suggestedNewNodes = [], suggestedTaskUpdates = [],
  suggestedGroupUpdates = [],
  suggestionPlan,
  error, onClose,
  onAddConnection, onRemoveEdge, onRemoveEntity, onAddNewNode, onUpdateTasks, onApplyGroupUpdate,
  onReAnalyze, analysisTimestamp,
  appliedConnectionKeys, appliedRemovalIds,
  isDemo = false,
}: AIAnalysisModalProps) {
  const { t } = useLanguage();
  const timeLabel   = useRelativeTime(analysisTimestamp);
  const modalRef    = useFocusTrap(isOpen);
  const [activeTab, setActiveTab] = useState<"findings" | "plan">("findings");

  // Local applied state (by array index) for types not tracked by parent
  const [appliedConnIdx,  setAppliedConnIdx]  = useState<Set<number>>(new Set());
  const [appliedEdgeIdx,  setAppliedEdgeIdx]  = useState<Set<number>>(new Set());
  const [appliedRemIdx,   setAppliedRemIdx]   = useState<Set<number>>(new Set());
  const [appliedNodeIdx,  setAppliedNodeIdx]  = useState<Set<number>>(new Set());
  const [appliedTaskIdx,  setAppliedTaskIdx]  = useState<Set<number>>(new Set());
  const [appliedGroupIdx, setAppliedGroupIdx] = useState<Set<number>>(new Set());

  // Refs for scrolling to suggestion cards when fishbone bone is clicked
  const connRefs    = useRef<(HTMLDivElement | null)[]>([]);
  const edgeRefs    = useRef<(HTMLDivElement | null)[]>([]);
  const remRefs     = useRef<(HTMLDivElement | null)[]>([]);
  const nodeRefs    = useRef<(HTMLDivElement | null)[]>([]);
  const taskRefs    = useRef<(HTMLDivElement | null)[]>([]);
  const groupRefs   = useRef<(HTMLDivElement | null)[]>([]);
  const [highlightId, setHighlightId] = useState<string | null>(null);

  // Reset tab when modal reopens with fresh data
  useEffect(() => {
    if (!isLoading && analysis) setActiveTab("findings");
  }, [analysis, isLoading]);

  if (!isOpen) return null;

  const sections       = analysis ? parseAnalysis(analysis) : [];
  const hasSuggestions = (
    suggestedConnections.length > 0 || suggestedEdgeRemovals.length > 0 ||
    suggestedRemovals.length > 0 || suggestedNewNodes.length > 0 || suggestedTaskUpdates.length > 0 ||
    suggestedGroupUpdates.length > 0
  ) && !isLoading && !error;
  const hasPlan        = false; // Phase plan section removed; ordering is enforced inline on action cards
  const isCachedResult = !!analysis && !isLoading && !!analysisTimestamp;

  // ── Fishbone scroll helper ──────────────────────────────────────────────────
  function scrollToBone(resolvedBy: FishboneBone["resolvedBy"]) {
    if (!resolvedBy) return;
    setActiveTab("plan");
    let el: HTMLDivElement | null = null;
    const { type, refId } = resolvedBy;
    if (type === "connection") {
      const idx = suggestedConnections.findIndex(c => `${c.sourceId}-${c.targetId}` === refId);
      el = connRefs.current[idx] ?? null;
    } else if (type === "edgeRemoval") {
      const idx = suggestedEdgeRemovals.findIndex(e => e.edgeId === refId);
      el = edgeRefs.current[idx] ?? null;
    } else if (type === "removal") {
      const idx = suggestedRemovals.findIndex(r => r.id === refId);
      el = remRefs.current[idx] ?? null;
    } else if (type === "newNode") {
      const idx = suggestedNewNodes.findIndex(n => n.tempId === refId);
      el = nodeRefs.current[idx] ?? null;
    } else if (type === "taskUpdate") {
      const idx = suggestedTaskUpdates.findIndex(t => t.nodeId === refId);
      el = taskRefs.current[idx] ?? null;
    } else if (type === "groupUpdate") {
      const idx = suggestedGroupUpdates.findIndex(g =>
        g.action === 'create' ? g.tempId === refId : g.groupId === refId
      );
      el = groupRefs.current[idx] ?? null;
    }
    if (el) {
      setTimeout(() => {
        el!.scrollIntoView({ behavior: "smooth", block: "center" });
        setHighlightId(refId);
        setTimeout(() => setHighlightId(null), 1800);
      }, 50);
    }
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="ai-analysis-title"
        className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[88vh] flex flex-col relative border border-slate-100">

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-8 pt-7 pb-5 border-b border-slate-100 flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0">
              <Sparkles className="w-4 h-4 text-indigo-600" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 id="ai-analysis-title" className="text-base font-bold text-slate-800">{t('analysisModal.title')}</h2>
                {isDemo && (
                  <span className="px-1.5 py-0.5 rounded-md bg-emerald-100 text-emerald-700 text-[10px] font-bold uppercase tracking-wider border border-emerald-200 shadow-sm flex items-center gap-1">
                    <Zap className="w-2.5 h-2.5" /> {t('demo.badge.label')}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <p className="text-xs text-slate-500">{isDemo ? t('demo.staticData') : t('analysisModal.subtitle')}</p>
                {isCachedResult && timeLabel && (
                  <span className="text-[10px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-full font-medium">{timeLabel}</span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {isCachedResult && onReAnalyze && (
              <button onClick={onReAnalyze} title={t('analysisModal.reAnalyze')}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-indigo-200 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 text-xs font-semibold transition-colors">
                <RefreshCw className="w-3 h-3" /> {t('analysisModal.reAnalyze')}
              </button>
            )}
            <button onClick={onClose}
              className="p-1.5 rounded-full hover:bg-slate-100 transition-colors text-slate-400 hover:text-slate-700">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ── Tabs (show whenever there are suggestions or a plan) ── */}
        {(hasSuggestions || hasPlan) && !isLoading && (
          <div className="flex gap-1 px-8 pt-3 pb-0 flex-shrink-0">
            <button
              onClick={() => setActiveTab("findings")}
              className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-colors ${activeTab === "findings" ? "bg-indigo-100 text-indigo-700" : "text-slate-500 hover:bg-slate-100"}`}
            >
              {t('analysisModal.tab.findings')}
            </button>
            <button
              onClick={() => setActiveTab("plan")}
              className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-colors ${activeTab === "plan" ? "bg-indigo-100 text-indigo-700" : "text-slate-500 hover:bg-slate-100"}`}
            >
              {t('analysisModal.tab.actions')}
              {hasSuggestions && (
                <span className="ml-1.5 inline-flex items-center justify-center w-4 h-4 rounded-full bg-indigo-600 text-white text-[9px] font-bold">
                  {suggestedConnections.length + suggestedEdgeRemovals.length + suggestedRemovals.length + suggestedNewNodes.length + suggestedTaskUpdates.length + suggestedGroupUpdates.length}
                </span>
              )}
            </button>
          </div>
        )}

        {/* ── Body ── */}
        <div className="flex-1 overflow-y-auto px-8 py-6 space-y-4">

          {/* Loading — with streaming text preview (Track 14d) */}
          {isLoading && !streamText && (
            <div className="flex flex-col items-center justify-center gap-3 py-14 text-slate-500">
              <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
              <p className="text-sm font-medium">{t('analysisModal.loading')}</p>
              <p className="text-xs text-slate-400">{t('analysisModal.loading.hint')}</p>
            </div>
          )}

          {/* Live streaming text — populates progressively as AI generates */}
          {isLoading && streamText && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 mb-3">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-500 shrink-0" />
                <span className="text-xs font-semibold text-indigo-600 uppercase tracking-wider">
                  {t('analysisModal.streaming')}
                </span>
              </div>
              <div className="bg-slate-50 border border-slate-100 rounded-2xl px-5 py-4">
                <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap font-mono">
                  {streamText}
                  <span className="inline-block w-1.5 h-4 ml-0.5 bg-indigo-500 animate-pulse align-middle rounded-sm" />
                </p>
              </div>
            </div>
          )}

          {/* Error */}
          {error && !isLoading && (
            <div className="flex items-start gap-3 p-4 rounded-xl bg-red-50 border border-red-100">
              <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-red-700 mb-0.5">{t('analysisModal.failed')}</p>
                <p className="text-sm text-red-600">{error}</p>
                {onReAnalyze && (
                  <button onClick={onReAnalyze}
                    className="mt-2 flex items-center gap-1 text-xs font-semibold text-red-600 hover:text-red-700 underline">
                    <RefreshCw className="w-3 h-3" /> {t('analysisModal.tryAgain')}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ═══════════ SUGGESTED ACTIONS TAB ═══════════ */}
          {activeTab === "plan" && (hasSuggestions || hasPlan) && (
            <div className="space-y-4">


              {/* ── Suggested Connections ── */}
              {hasSuggestions && suggestedConnections.length > 0 && (
                <SuggestionSection title={t('suggestion.connections.title')} subtitle={t('suggestion.connections.subtitle')}
                  icon={<Plus className="w-3 h-3 text-emerald-600" />}
                  iconBg="bg-emerald-100">
                  {suggestedConnections.map((conn, i) => {
                    const connKey   = `${conn.sourceId}-${conn.targetId}`;
                    const isApplied = appliedConnIdx.has(i) || appliedConnectionKeys?.has(connKey);
                    const isHighlit = highlightId === connKey;
                    return (
                      <div key={i} ref={el => { connRefs.current[i] = el; }}
                        className={`flex items-start justify-between gap-3 p-4 rounded-xl border transition-all ${
                          isHighlit ? "ring-2 ring-indigo-400 border-indigo-200 bg-indigo-50/30" :
                          isApplied ? "border-slate-200 bg-slate-50/60" :
                          "border-emerald-100 bg-emerald-50/40"
                        }`}>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-700 mb-1 flex-wrap">
                            <span className={`truncate max-w-[130px] ${isApplied ? "text-slate-400" : "text-emerald-600"}`}>{conn.sourceName}</span>
                            <span className="text-slate-400 text-xs flex-shrink-0">→</span>
                            <span className={`truncate max-w-[130px] ${isApplied ? "text-slate-400" : "text-emerald-600"}`}>{conn.targetName}</span>
                            {conn.connectionName && (
                              <span className="text-[10px] font-medium text-slate-500 bg-white border border-slate-200 px-1.5 py-0.5 rounded-full flex-shrink-0 ml-1">{conn.connectionName}</span>
                            )}
                          </div>
                          <p className="text-xs text-slate-500 leading-relaxed">{conn.reason}</p>
                          {conn.cascadeEffects && conn.cascadeEffects.length > 0 && (
                            <CascadeList effects={conn.cascadeEffects} />
                          )}
                        </div>
                        {onAddConnection && (
                          isApplied ? (
                            <span className="flex-shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-100 text-slate-400 text-xs font-semibold cursor-default">
                              <Check className="w-3 h-3" /> {t('suggestion.connections.added')}
                            </span>
                          ) : (
                            <button
                              onClick={() => { onAddConnection(conn); setAppliedConnIdx(s => new Set([...s, i])); }}
                              className="flex-shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-semibold transition-colors">
                              <Plus className="w-3 h-3" /> {t('suggestion.connections.add')}
                            </button>
                          )
                        )}
                      </div>
                    );
                  })}
                </SuggestionSection>
              )}

              {/* ── Redundant Edge Removals ── */}
              {hasSuggestions && suggestedEdgeRemovals.length > 0 && (
                <SuggestionSection title={t('suggestion.edgeRemovals.title')} subtitle={t('suggestion.edgeRemovals.subtitle')}
                  icon={<Link2Off className="w-3 h-3 text-orange-500" />}
                  iconBg="bg-orange-100">
                  {suggestedEdgeRemovals.map((rem, i) => {
                    const isApplied = appliedEdgeIdx.has(i);
                    const isHighlit = highlightId === rem.edgeId;
                    // Find if there's a prerequisite connection not yet applied
                    const prereqKey  = rem.prerequisiteConnectionId ?? null;
                    const prereqDone = !prereqKey || (appliedConnectionKeys?.has(prereqKey) || [...appliedConnIdx].some(idx => {
                      const c = suggestedConnections[idx];
                      return c && `${c.sourceId}-${c.targetId}` === prereqKey;
                    }));
                    return (
                      <div key={i} ref={el => { edgeRefs.current[i] = el; }}
                        className={`flex items-start justify-between gap-3 p-4 rounded-xl border transition-all ${
                          isHighlit ? "ring-2 ring-orange-400 border-orange-200 bg-orange-50/30" :
                          isApplied ? "border-slate-200 bg-slate-50/60 opacity-60" :
                          "border-orange-100 bg-orange-50/30"
                        }`}>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 text-sm font-semibold mb-1 flex-wrap">
                            <span className={`truncate max-w-[130px] ${isApplied ? "text-slate-400" : "text-orange-600"}`}>{rem.sourceName}</span>
                            <span className="text-slate-400 text-xs flex-shrink-0">→</span>
                            <span className={`truncate max-w-[130px] ${isApplied ? "text-slate-400" : "text-orange-600"}`}>{rem.targetName}</span>
                          </div>
                          <p className="text-xs text-slate-500 leading-relaxed">{rem.reason}</p>
                          {!prereqDone && prereqKey && (
                            <p className="text-[10px] text-amber-600 mt-1.5 flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3" />
                              {t('suggestion.edgeRemovals.prereq')}
                            </p>
                          )}
                        </div>
                        {onRemoveEdge && (
                          isApplied ? (
                            <span className="flex-shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-100 text-slate-400 text-xs font-semibold cursor-default border border-slate-200">
                              <Check className="w-3 h-3" /> {t('suggestion.edgeRemovals.removed')}
                            </span>
                          ) : (
                            <button
                              disabled={!prereqDone}
                              onClick={() => { onRemoveEdge(rem); setAppliedEdgeIdx(s => new Set([...s, i])); }}
                              title={!prereqDone ? t('suggestion.prereqNote') : undefined}
                              className={`flex-shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${
                                !prereqDone
                                  ? "bg-slate-50 text-slate-300 border-slate-200 cursor-not-allowed"
                                  : "bg-orange-50 text-orange-600 border-orange-200 hover:bg-orange-100"
                              }`}>
                              <MinusCircle className="w-3 h-3" /> {t('suggestion.edgeRemovals.remove')}
                            </button>
                          )
                        )}
                      </div>
                    );
                  })}
                </SuggestionSection>
              )}

              {/* ── Suggested New Nodes ── */}
              {hasSuggestions && suggestedNewNodes.length > 0 && (
                <SuggestionSection title={t('suggestion.newNodes.title')} subtitle={t('suggestion.newNodes.subtitle')}
                  icon={<Zap className="w-3 h-3 text-violet-600" />}
                  iconBg="bg-violet-100">
                  {suggestedNewNodes.map((node, i) => {
                    const isApplied = appliedNodeIdx.has(i);
                    const isHighlit = highlightId === node.tempId;
                    return (
                      <div key={i} ref={el => { nodeRefs.current[i] = el; }}
                        className={`flex items-start justify-between gap-3 p-4 rounded-xl border transition-all ${
                          isHighlit ? "ring-2 ring-violet-400 border-violet-200 bg-violet-50/30" :
                          isApplied ? "border-slate-200 bg-slate-50/60 opacity-60" :
                          "border-violet-100 bg-violet-50/30"
                        }`}>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span className={`text-sm font-semibold ${isApplied ? "text-slate-400" : "text-violet-700"}`}>{node.label}</span>
                            <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full border border-violet-200 bg-violet-50 text-violet-500">{node.role}</span>
                            {node.replacesNodeId && (
                              <span className="text-[10px] text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">{t('suggestion.newNodes.replaces')}</span>
                            )}
                          </div>
                          <p className="text-xs text-slate-500 leading-relaxed mb-1.5">{node.summary}</p>
                          {(node.connectFrom.length > 0 || node.connectTo.length > 0) && (
                            <div className="text-[10px] text-slate-400 space-y-0.5">
                              {node.connectFrom.length > 0 && <div>← From: {node.connectFrom.join(", ")}</div>}
                              {node.connectTo.length > 0   && <div>→ To: {node.connectTo.join(", ")}</div>}
                            </div>
                          )}
                        </div>
                        {onAddNewNode && (
                          isApplied ? (
                            <span className="flex-shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-100 text-slate-400 text-xs font-semibold cursor-default">
                              <Check className="w-3 h-3" /> {t('suggestion.newNodes.added')}
                            </span>
                          ) : (
                            <button
                              onClick={() => { onAddNewNode(node); setAppliedNodeIdx(s => new Set([...s, i])); }}
                              className="flex-shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg bg-violet-500 hover:bg-violet-600 text-white text-xs font-semibold transition-colors">
                              <Plus className="w-3 h-3" /> {t('suggestion.newNodes.add')}
                            </button>
                          )
                        )}
                      </div>
                    );
                  })}
                </SuggestionSection>
              )}

              {/* ── Suggested Removals ── */}
              {hasSuggestions && suggestedRemovals.length > 0 && (
                <SuggestionSection title={t('suggestion.removals.title')} subtitle={t('suggestion.removals.subtitle')}
                  icon={<AlertTriangle className="w-3 h-3 text-red-500" />}
                  iconBg="bg-red-100">
                  {suggestedRemovals.map((rem, i) => {
                    const isApplied = appliedRemIdx.has(i) || (rem.type === "node" && appliedRemovalIds?.has(rem.id));
                    const isHighlit = highlightId === rem.id;
                    return (
                      <div key={i} ref={el => { remRefs.current[i] = el; }}
                        className={`flex items-start justify-between gap-3 p-4 rounded-xl border transition-all ${
                          isHighlit ? "ring-2 ring-red-300 border-red-200 bg-red-50/30" :
                          isApplied ? "border-slate-200 bg-slate-50/40 opacity-60" :
                          "border-slate-200 bg-slate-50/60"
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
                                ? (t((`suggestion.action.${rem.action === 'remove' ? 'removed' : rem.action === 'automate' ? 'automated' : 'merged'}`) as any) ?? rem.action)
                                : (t((`suggestion.action.${rem.action}`) as any) ?? rem.action)}
                            </span>
                            {rem.action === "merge" && rem.mergeTargetId && !isApplied && (
                              <span className="text-[10px] text-slate-400">→ into {rem.mergeTargetId}</span>
                            )}
                          </div>
                          <p className="text-xs text-slate-500 leading-relaxed">{rem.reason}</p>
                          {rem.fishboneBones && rem.fishboneBones.length > 0 && (
                            <div className="mt-3">
                              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-2">{t('suggestion.removals.rootCause')}</p>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {rem.fishboneBones.map((bone, idx) => (
                                  <div key={idx}
                                    className={`bg-white/60 rounded-lg p-2.5 border border-slate-100/50 shadow-sm ${bone.resolvedBy ? "cursor-pointer hover:border-indigo-200 hover:bg-indigo-50/20 transition-colors" : ""}`}
                                    onClick={() => bone.resolvedBy && scrollToBone(bone.resolvedBy)}
                                    title={bone.resolvedBy ? "Click to jump to the suggested fix" : undefined}
                                  >
                                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1 flex items-center gap-1.5">
                                      <span className="w-1.5 h-1.5 rounded-full bg-slate-300" />
                                      {bone.category}
                                    </div>
                                    <div className="text-xs text-slate-600 leading-snug">{bone.cause}</div>
                                    {bone.resolvedBy && (
                                      <div className="mt-1.5 flex items-center gap-1 text-[10px] text-indigo-500 font-semibold">
                                        <span>{t('suggestion.removals.seeFix')}</span>
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                        {onRemoveEntity && (
                          isApplied ? (
                            <span className="flex-shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-100 text-slate-400 text-xs font-semibold cursor-default border border-slate-200">
                              <Check className="w-3 h-3" /> {t((`suggestion.action.${rem.action === 'remove' ? 'removed' : rem.action === 'automate' ? 'automated' : 'merged'}`) as any) ?? t('suggestion.action.applied')}
                            </span>
                          ) : (
                            <button
                              onClick={() => { onRemoveEntity(rem); setAppliedRemIdx(s => new Set([...s, i])); }}
                              className={`flex-shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${ACTION_COLOR[rem.action] ?? "bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200"}`}>
                              {ACTION_ICON[rem.action] ?? <Trash2 className="w-3 h-3" />}
                              {t((`suggestion.action.${rem.action}`) as any) ?? t('suggestion.tasks.apply')}
                            </button>
                          )
                        )}
                      </div>
                    );
                  })}
                </SuggestionSection>
              )}

              {/* ── Task Updates ── */}
              {hasSuggestions && suggestedTaskUpdates.length > 0 && (
                <SuggestionSection title={t('suggestion.tasks.title')} subtitle={t('suggestion.tasks.subtitle')}
                  icon={<ClipboardList className="w-3 h-3 text-sky-500" />}
                  iconBg="bg-sky-100">
                  {suggestedTaskUpdates.map((upd, i) => {
                    const isApplied = appliedTaskIdx.has(i);
                    const isHighlit = highlightId === upd.nodeId;
                    return (
                      <div key={i} ref={el => { taskRefs.current[i] = el; }}
                        className={`flex items-start justify-between gap-3 p-4 rounded-xl border transition-all ${
                          isHighlit ? "ring-2 ring-sky-400 border-sky-200 bg-sky-50/30" :
                          isApplied ? "border-slate-200 bg-slate-50/60 opacity-60" :
                          "border-sky-100 bg-sky-50/30"
                        }`}>
                        <div className="min-w-0 flex-1">
                          <span className={`text-sm font-semibold ${isApplied ? "text-slate-400" : "text-sky-700"}`}>{upd.nodeName}</span>
                          <p className="text-xs text-slate-500 leading-relaxed mt-0.5 mb-2">{upd.reason}</p>
                          {upd.addTasks.length > 0 && (
                            <div className="space-y-1">
                              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">{t('suggestion.tasks.addTasks')}</p>
                              {upd.addTasks.map(t => (
                                <div key={t.id} className="flex items-center gap-1.5 text-xs text-slate-600">
                                  <Plus className="w-3 h-3 text-emerald-500 flex-shrink-0" />
                                  <span>{t.title}</span>
                                  <span className="text-[10px] text-slate-400">[{t.priority}]</span>
                                </div>
                              ))}
                            </div>
                          )}
                          {upd.removeTasks.length > 0 && (
                            <div className="mt-1.5 space-y-1">
                              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">{t('suggestion.tasks.removeTasks')}</p>
                              {upd.removeTasks.map(id => (
                                <div key={id} className="flex items-center gap-1.5 text-xs text-slate-400">
                                  <MinusCircle className="w-3 h-3 text-red-400 flex-shrink-0" />
                                  <span className="font-mono">{id}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                        {onUpdateTasks && (
                          isApplied ? (
                            <span className="flex-shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-100 text-slate-400 text-xs font-semibold cursor-default">
                              <Check className="w-3 h-3" /> {t('suggestion.tasks.applied')}
                            </span>
                          ) : (
                            <button
                              onClick={() => { onUpdateTasks(upd); setAppliedTaskIdx(s => new Set([...s, i])); }}
                              className="flex-shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-600 text-white text-xs font-semibold transition-colors">
                              <ClipboardList className="w-3 h-3" /> {t('suggestion.tasks.apply')}
                            </button>
                          )
                        )}
                      </div>
                    );
                  })}
                </SuggestionSection>
              )}

              {/* ── Group Updates ── */}
              {hasSuggestions && suggestedGroupUpdates.length > 0 && (
                <SuggestionSection title={t('suggestion.groups.title')} subtitle={t('suggestion.groups.subtitle')}
                  icon={<Layers className="w-3 h-3 text-teal-500" />}
                  iconBg="bg-teal-100">
                  {suggestedGroupUpdates.map((upd, i) => {
                    const isApplied   = appliedGroupIdx.has(i);
                    const refId       = upd.action === 'create' ? upd.tempId : upd.groupId;
                    const isHighlit   = highlightId === (refId ?? '');
                    const displayName = upd.action === 'create' ? upd.name : (upd.currentName ?? upd.groupId ?? '');
                    return (
                      <div key={i} ref={el => { groupRefs.current[i] = el; }}
                        className={`flex items-start justify-between gap-3 p-4 rounded-xl border transition-all ${
                          isHighlit ? "ring-2 ring-teal-400 border-teal-200 bg-teal-50/30" :
                          isApplied ? "border-slate-200 bg-slate-50/60 opacity-60" :
                          "border-teal-100 bg-teal-50/30"
                        }`}>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            {upd.color && !isApplied && (
                              <span className="w-3 h-3 rounded-full flex-shrink-0 border border-white/50 shadow-sm"
                                style={{ backgroundColor: upd.color }} />
                            )}
                            <span className={`text-sm font-semibold truncate ${isApplied ? "text-slate-400" : "text-teal-700"}`}>
                              {displayName ?? t('suggestion.groups.unnamed')}
                            </span>
                            <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full border ${
                              isApplied ? "bg-slate-100 text-slate-400 border-slate-200" :
                              upd.action === 'create' ? "bg-emerald-50 text-emerald-600 border-emerald-200" :
                              upd.action === 'delete' ? "bg-red-50 text-red-500 border-red-200" :
                              "bg-teal-50 text-teal-600 border-teal-200"
                            }`}>
                              {isApplied
                                ? (upd.action === 'create' ? t('suggestion.groups.created') : upd.action === 'delete' ? t('suggestion.groups.deleted') : t('suggestion.groups.updated'))
                                : (upd.action === 'create' ? t('suggestion.groups.create') : upd.action === 'delete' ? t('suggestion.groups.delete') : t('suggestion.groups.update'))}
                            </span>
                            {upd.action === 'update' && upd.name && upd.name !== upd.currentName && !isApplied && (
                              <span className="text-[10px] text-slate-400">→ &ldquo;{upd.name}&rdquo;</span>
                            )}
                          </div>
                          <p className="text-xs text-slate-500 leading-relaxed mb-1.5">{upd.reason}</p>
                          {!isApplied && upd.action !== 'delete' && (
                            <div className="text-[10px] text-slate-400 space-y-0.5">
                              {upd.action === 'create' && upd.nodeIds && upd.nodeIds.length > 0 && (
                                <div>{t('suggestion.groups.members').replace('{list}', upd.nodeIds.join(", "))}</div>
                              )}
                              {upd.action === 'update' && (upd.addNodeIds?.length ?? 0) > 0 && (
                                <div className="text-emerald-600">{t('suggestion.groups.addMembers').replace('{list}', upd.addNodeIds!.join(", "))}</div>
                              )}
                              {upd.action === 'update' && (upd.removeNodeIds?.length ?? 0) > 0 && (
                                <div className="text-red-500">{t('suggestion.groups.removeMembers').replace('{list}', upd.removeNodeIds!.join(", "))}</div>
                              )}
                            </div>
                          )}
                        </div>
                        {onApplyGroupUpdate && (
                          isApplied ? (
                            <span className="flex-shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-100 text-slate-400 text-xs font-semibold cursor-default">
                              <Check className="w-3 h-3" /> {t('suggestion.groups.applied')}
                            </span>
                          ) : (
                            <button
                              onClick={() => { onApplyGroupUpdate(upd); setAppliedGroupIdx(s => new Set([...s, i])); }}
                              className={`flex-shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${
                                upd.action === 'delete'
                                  ? "bg-red-50 text-red-600 border-red-200 hover:bg-red-100"
                                  : "bg-teal-50 text-teal-600 border-teal-200 hover:bg-teal-100"
                              }`}>
                              {upd.action === 'delete'
                                ? <><Trash2 className="w-3 h-3" /> {t('suggestion.groups.delete')}</>
                                : upd.action === 'create'
                                  ? <><Plus className="w-3 h-3" /> {t('suggestion.groups.create')}</>
                                  : <><RefreshCw className="w-3 h-3" /> {t('suggestion.groups.update')}</>
                              }
                            </button>
                          )
                        )}
                      </div>
                    );
                  })}
                </SuggestionSection>
              )}
            </div>
          )}

          {/* ═══════════ FINDINGS TAB ═══════════ */}
          {activeTab === "findings" && (
            <>
              {/* Section cards */}
              {!isLoading && sections.length > 0 && (
                <div className="space-y-3">
                  {sections.map((section) => (
                    <div key={section.title}
                      className={`rounded-2xl border p-5 ${section.config.bg} ${section.config.border}`}>
                      <div className="flex items-center gap-2.5 mb-3">
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${section.config.iconBg}`}>
                          {section.config.icon}
                        </div>
                        <h3 className={`text-sm font-bold ${section.config.titleColor}`}>{section.title}</h3>
                      </div>
                      <ul className="space-y-2.5">
                        {section.items.map((item, idx) => {
                          const node = parseNodeAnalysisItem(item);
                          if (node) {
                            // Per-node / group analysis card: label + expandable body
                            return (
                              <li key={idx} className="rounded-xl border border-slate-100 bg-white/70 px-4 py-3">
                                <p className={`text-xs font-bold mb-1 ${section.config.titleColor}`}>{node.label}</p>
                                <ExpandableText
                                  text={node.text}
                                  className="text-sm text-slate-700 leading-relaxed"
                                />
                              </li>
                            );
                          }
                          return (
                            <li key={idx} className="flex items-start gap-2.5">
                              <span className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${section.config.dotColor}`} />
                              <ExpandableText
                                text={item}
                                className="text-sm text-slate-700 leading-relaxed"
                              />
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </div>
              )}

              {/* Fallback raw text */}
              {!isLoading && analysis && sections.length === 0 && (
                <div className="rounded-2xl border border-slate-100 bg-slate-50/60 p-5">
                  <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{analysis}</p>
                </div>
              )}

              {/* Nudge to switch to Actions tab when suggestions exist */}
              {hasSuggestions && !isLoading && (
                <button
                  onClick={() => setActiveTab("plan")}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border border-dashed border-indigo-200 bg-indigo-50/40 text-xs font-semibold text-indigo-500 hover:bg-indigo-50 transition-colors">
                  {t('analysisModal.viewActions').replace('{n}', String(suggestedConnections.length + suggestedEdgeRemovals.length + suggestedRemovals.length + suggestedNewNodes.length + suggestedTaskUpdates.length + suggestedGroupUpdates.length))}
                </button>
              )}
            </>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="px-8 pb-6 pt-3 border-t border-slate-100 flex-shrink-0 flex items-center justify-between gap-3">
          {onReAnalyze && !isLoading && !isCachedResult && (
            <button onClick={onReAnalyze}
              className="flex items-center gap-1.5 text-xs text-indigo-600 hover:text-indigo-700 font-semibold">
              <RefreshCw className="w-3 h-3" /> {t('analysisModal.runAnalysis')}
            </button>
          )}
          <div className="flex-1" />
          <button onClick={onClose}
            className="px-6 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-sm font-semibold hover:bg-slate-50 transition-colors">
            {t('analysisModal.close')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Helper sub-components ────────────────────────────────────────────────────

function SuggestionSection({ title, subtitle, icon, iconBg, children }: {
  title: string; subtitle: string;
  icon: React.ReactNode; iconBg: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3 mt-2">
        <div className={`w-5 h-5 rounded-full ${iconBg} flex items-center justify-center flex-shrink-0`}>
          {icon}
        </div>
        <h3 className="text-sm font-bold text-slate-800">{title}</h3>
        <span className="text-xs text-slate-400">— {subtitle}</span>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

// ─── Inline markdown renderer (handles **bold** spans) ───────────────────────

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*\n]+\*\*)/g);
  if (parts.length === 1) return text;
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith("**") && part.endsWith("**")
          ? <strong key={i} className="font-semibold text-slate-800">{part.slice(2, -2)}</strong>
          : part
      )}
    </>
  );
}

// ─── JSON blob extractor ──────────────────────────────────────────────────────
// Items in Per-Node / Group Analysis can arrive as:
//   "Email / Inbox: {"analysis": "Long text..."}"
// This extracts the label and the inner text, stripping the raw JSON wrapper.

interface NodeItem { label: string; text: string }

function parseNodeAnalysisItem(raw: string): NodeItem | null {
  // Find the first `{` — everything before it is the label, everything after is JSON
  const braceIdx = raw.indexOf(': {');
  if (braceIdx === -1) return null;
  const label     = raw.slice(0, braceIdx).trim();
  const jsonPart  = raw.slice(braceIdx + 2).trim(); // starts at `{`
  try {
    const parsed = JSON.parse(jsonPart);
    // Accept any string value — prefer common key names
    const text =
      typeof parsed.analysis  === 'string' ? parsed.analysis  :
      typeof parsed.text      === 'string' ? parsed.text      :
      typeof parsed.summary   === 'string' ? parsed.summary   :
      typeof parsed.content   === 'string' ? parsed.content   :
      // fallback: first string-valued key
      Object.values(parsed).find(v => typeof v === 'string') as string | undefined;
    if (text) return { label, text };
  } catch { /* malformed JSON — fall through */ }
  return null;
}

// ─── Expandable text ──────────────────────────────────────────────────────────
// Long analysis bullets are clamped; clicking "Read more" reveals the rest.

const EXPAND_THRESHOLD = 200;

function ExpandableText({ text, className }: { text: string; className?: string }) {
  const [expanded, setExpanded] = useState(false);
  const needsExpand = text.length > EXPAND_THRESHOLD;
  const display = needsExpand && !expanded ? text.slice(0, EXPAND_THRESHOLD) + '…' : text;
  return (
    <span className={className}>
      {renderInline(display)}
      {needsExpand && !expanded && (
        <button
          onClick={() => setExpanded(true)}
          className="ml-1.5 text-[10px] font-semibold text-indigo-500 hover:text-indigo-700 underline underline-offset-2 transition-colors"
        >
          Read more
        </button>
      )}
    </span>
  );
}

function CascadeList({ effects }: { effects: CascadeEffect[] }) {
  return (
    <div className="mt-3 pl-3 border-l-2 border-emerald-200/50 space-y-2">
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Cascading Impact</p>
      {effects.map(effect => (
        <div key={effect.id} className="flex items-start gap-2">
          {cascadeIcon(effect.type)}
          <div>
            <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded mr-1.5 ${cascadeBadgeClass(effect.type)}`}>
              {effect.type}
            </span>
            <span className="text-[10px] text-slate-400 mr-1.5">depth {effect.depth}</span>
            <span className="text-xs text-slate-600">{effect.description}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
