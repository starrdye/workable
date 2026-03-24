"use client";

import { useState } from "react";
import { X, Sparkles, Loader2, AlertCircle, Plus, Trash2, Zap, Check } from "lucide-react";

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
}

function renderMarkdown(text: string) {
  return text.split("\n").map((line, i) => {
    if (line.startsWith("## ")) {
      return (
        <h3 key={i} className="text-sm font-bold text-slate-800 mt-5 mb-2 first:mt-0">
          {line.slice(3)}
        </h3>
      );
    }
    if (line.startsWith("- ") || line.startsWith("• ")) {
      return (
        <li key={i} className="text-sm text-slate-600 leading-relaxed ml-3 list-disc">
          {line.slice(2)}
        </li>
      );
    }
    if (/^\d+\.\s/.test(line)) {
      return (
        <li key={i} className="text-sm text-slate-600 leading-relaxed ml-3 list-decimal">
          {line.replace(/^\d+\.\s/, "")}
        </li>
      );
    }
    if (line.trim() === "") return <div key={i} className="h-1" />;
    return <p key={i} className="text-sm text-slate-600 leading-relaxed">{line}</p>;
  });
}

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

export function AIAnalysisModal({
  isOpen, isLoading, analysis, suggestedConnections = [], suggestedRemovals = [],
  error, onClose, onAddConnection, onRemoveEntity,
}: AIAnalysisModalProps) {
  const [appliedConnections, setAppliedConnections] = useState<Set<number>>(new Set());
  const [appliedRemovals,    setAppliedRemovals]    = useState<Set<number>>(new Set());

  if (!isOpen) return null;

  const hasSuggestions = (suggestedConnections.length > 0 || suggestedRemovals.length > 0) && !isLoading && !error;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col relative border border-slate-100">
        {/* Header */}
        <div className="flex items-center justify-between px-8 pt-7 pb-5 border-b border-slate-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-indigo-100 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-indigo-600" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-800">AI Workflow Analysis</h2>
              <p className="text-xs text-slate-500">Powered by Claude · click suggestions to apply them</p>
            </div>
          </div>
          <button onClick={onClose}
            className="p-1.5 rounded-full hover:bg-slate-100 transition-colors text-slate-400 hover:text-slate-700">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-8 py-6 space-y-6">
          {isLoading && (
            <div className="flex flex-col items-center justify-center gap-3 py-12 text-slate-500">
              <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
              <p className="text-sm">Analyzing your workflow…</p>
            </div>
          )}

          {error && !isLoading && (
            <div className="flex items-start gap-3 p-4 rounded-xl bg-red-50 border border-red-100">
              <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {/* Analysis text */}
          {analysis && !isLoading && (
            <div className="space-y-0.5">
              {renderMarkdown(analysis)}
            </div>
          )}

          {/* ── Suggested Connections ── */}
          {hasSuggestions && suggestedConnections.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-5 h-5 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
                  <Plus className="w-3 h-3 text-emerald-600" />
                </div>
                <h3 className="text-sm font-bold text-slate-800">Suggested Connections</h3>
                <span className="text-xs text-slate-400 font-normal">— new routes to add</span>
              </div>
              <div className="space-y-2">
                {suggestedConnections.map((conn, i) => {
                  const isApplied = appliedConnections.has(i);
                  return (
                  <div key={i}
                    className={`flex items-start justify-between gap-3 p-3.5 rounded-xl border transition-colors ${
                      isApplied ? "border-slate-200 bg-slate-50/60" : "border-emerald-100 bg-emerald-50/40"
                    }`}>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-700 mb-0.5 flex-wrap">
                        <span className={`truncate max-w-[120px] ${isApplied ? "text-slate-400" : "text-emerald-600"}`}>{conn.sourceName}</span>
                        <span className="text-slate-400 text-xs flex-shrink-0">→</span>
                        <span className={`truncate max-w-[120px] ${isApplied ? "text-slate-400" : "text-emerald-600"}`}>{conn.targetName}</span>
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
                  <Zap className="w-3 h-3 text-red-500" />
                </div>
                <h3 className="text-sm font-bold text-slate-800">Suggested Changes</h3>
                <span className="text-xs text-slate-400 font-normal">— entities to remove or automate</span>
              </div>
              <div className="space-y-2">
                {suggestedRemovals.map((rem, i) => {
                  const isApplied = appliedRemovals.has(i);
                  return (
                  <div key={i}
                    className={`flex items-start justify-between gap-3 p-3.5 rounded-xl border transition-colors ${
                      isApplied ? "border-slate-200 bg-slate-50/40 opacity-60" : "border-slate-200 bg-slate-50/60"
                    }`}>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-0.5 flex-wrap">
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

        {/* Footer */}
        <div className="px-8 pb-6 pt-3 border-t border-slate-100 flex-shrink-0">
          <button onClick={onClose}
            className="w-full py-2.5 rounded-xl border border-slate-200 text-slate-600 text-sm font-semibold hover:bg-slate-50 transition-colors">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
