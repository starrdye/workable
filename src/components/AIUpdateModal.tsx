"use client";

import { useEffect, useRef, useState } from "react";
import { X, GitMerge, Loader2, AlertCircle, Plus, Trash2, Pencil, ChevronLeft, ArrowRight } from "lucide-react";
import { useFocusTrap } from "@/hooks/useFocusTrap";

// ── Public types (re-exported so page.tsx can import them) ────────────────────

export interface AITaskItem {
  id: string;
  title: string;
  status: "todo" | "in-progress" | "done" | "blocked" | "review";
  priority: "low" | "medium" | "high";
  note?: string;
}

export interface AIUpdateAddNode {
  id: string;
  name: string;
  initials: string;
  role: string;
  summary?: string;
  constraints?: string;
  tasks?: AITaskItem[];
}

export interface AIUpdateAddEdge {
  id: string;
  source: string;
  target: string;
  name?: string;
}

export interface AIUpdateAddGroup {
  id: string;
  name: string;
  color: string;
  nodeIds: string[];
  parentGroupId?: string | null;
}

export interface AIUpdateNode {
  id: string;
  name?: string;
  role?: string;
  summary?: string;
  constraints?: string;
}

export interface AIUpdateGroupExtension {
  groupId: string;
  addNodeIds: string[];
  removeNodeIds: string[];
}

export interface AIUpdateGroupPatch {
  groupId: string;
  name?: string;
  color?: string;
}

export interface AIUpdateNodeTasks {
  nodeId: string;
  tasks: AITaskItem[];
}

export interface AIUpdateEdgePatch {
  id: string;
  name?: string;
  summary?: string;
}

export interface AIUpdateResult {
  summary: string;
  add: {
    nodes: AIUpdateAddNode[];
    edges: AIUpdateAddEdge[];
    groups: AIUpdateAddGroup[];
  };
  update: {
    nodes: AIUpdateNode[];
    groupExtensions: AIUpdateGroupExtension[];
    groups: AIUpdateGroupPatch[];
    nodeTasks: AIUpdateNodeTasks[];
    edges: AIUpdateEdgePatch[];
  };
  remove: {
    nodeIds: string[];
    edgeIds: string[];
    groupIds: string[];
  };
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface AIUpdateModalProps {
  isOpen:    boolean;
  isLoading: boolean;
  result:    AIUpdateResult | null;
  error:     string | null;
  onClose:   () => void;
  onSubmit:  (prompt: string) => void;
  onApply:   (result: AIUpdateResult) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const ROLE_COLOR: Record<string, string> = {
  person:   "#4F46E5",
  tool:     "#64748B",
  external: "#475569",
  output:   "#10B981",
};

const ROLE_BADGE: Record<string, string> = {
  person:   "bg-indigo-50 text-indigo-600 border-indigo-200",
  tool:     "bg-slate-50 text-slate-600 border-slate-200",
  external: "bg-pink-50 text-pink-600 border-pink-200",
  output:   "bg-emerald-50 text-emerald-600 border-emerald-200",
};

const EXAMPLES = [
  "Alice joins the team as Bob's apprentice and will assist with reporting",
  "The reporting tool was replaced by a newer platform",
  "Charlie transferred to a different department",
  "A new approval step was added between data entry and final review",
  "The team lead was promoted and now oversees two additional processes",
];

function diffSummaryPill(result: AIUpdateResult) {
  const parts: string[] = [];
  const addNodes   = result.add.nodes.length;
  const addEdges   = result.add.edges.length;
  const addGroups  = result.add.groups.length;
  const totalUpd   = result.update.nodes.length
    + result.update.groupExtensions.length
    + (result.update.groups?.length ?? 0)
    + (result.update.nodeTasks?.length ?? 0)
    + (result.update.edges?.length ?? 0);
  const rmNodes    = result.remove.nodeIds.length;
  const rmEdges    = result.remove.edgeIds.length;
  const rmGroups   = result.remove.groupIds?.length ?? 0;

  if (addNodes)  parts.push(`+${addNodes} node${addNodes > 1 ? "s" : ""}`);
  if (addEdges)  parts.push(`+${addEdges} edge${addEdges > 1 ? "s" : ""}`);
  if (addGroups) parts.push(`+${addGroups} group${addGroups > 1 ? "s" : ""}`);
  if (totalUpd)  parts.push(`✎ ${totalUpd} update${totalUpd > 1 ? "s" : ""}`);
  if (rmNodes)   parts.push(`−${rmNodes} node${rmNodes > 1 ? "s" : ""}`);
  if (rmEdges)   parts.push(`−${rmEdges} edge${rmEdges > 1 ? "s" : ""}`);
  if (rmGroups)  parts.push(`−${rmGroups} group${rmGroups > 1 ? "s" : ""}`);

  return parts.length > 0 ? parts.join("  ·  ") : "No changes";
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AIUpdateModal({
  isOpen, isLoading, result, error, onClose, onSubmit, onApply,
}: AIUpdateModalProps) {
  const [view, setView]       = useState<"prompt" | "preview">("prompt");
  const [prompt, setPrompt]   = useState("");
  const textareaRef           = useRef<HTMLTextAreaElement>(null);
  const modalRef              = useFocusTrap(isOpen);

  // Switch to preview automatically when result arrives
  useEffect(() => {
    if (result && !isLoading) setView("preview");
  }, [result, isLoading]);

  // Reset to prompt panel whenever modal opens fresh
  useEffect(() => {
    if (isOpen) {
      setView("prompt");
    }
  }, [isOpen]);

  // Auto-focus textarea on open
  useEffect(() => {
    if (isOpen && view === "prompt") {
      setTimeout(() => textareaRef.current?.focus(), 60);
    }
  }, [isOpen, view]);

  if (!isOpen) return null;

  const handleSubmit = () => {
    if (!prompt.trim() || isLoading) return;
    onSubmit(prompt.trim());
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSubmit();
  };

  const handleClose = () => {
    setPrompt("");
    setView("prompt");
    onClose();
  };

  const handleBack = () => setView("prompt");

  const hasAdd    = result && (result.add.nodes.length + result.add.edges.length + result.add.groups.length) > 0;
  const hasUpdate = result && (
    result.update.nodes.length +
    result.update.groupExtensions.length +
    (result.update.groups?.length ?? 0) +
    (result.update.nodeTasks?.length ?? 0) +
    (result.update.edges?.length ?? 0)
  ) > 0;
  const hasRemove = result && (
    result.remove.nodeIds.length +
    result.remove.edgeIds.length +
    (result.remove.groupIds?.length ?? 0)
  ) > 0;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="ai-update-title" className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col relative border border-slate-100">

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-8 pt-7 pb-5 border-b border-slate-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-violet-100 flex items-center justify-center">
              <GitMerge className="w-4 h-4 text-violet-600" />
            </div>
            <div>
              <h2 id="ai-update-title" className="text-base font-bold text-slate-800">AI Update</h2>
              {view === "preview" && result ? (
                <p className="text-xs text-slate-500 font-medium">{diffSummaryPill(result)}</p>
              ) : (
                <p className="text-xs text-slate-500">Describe any change to your workflow in plain English</p>
              )}
            </div>
          </div>
          <button onClick={handleClose}
            className="p-1.5 rounded-full hover:bg-slate-100 transition-colors text-slate-400 hover:text-slate-700">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Body ── */}
        <div className="flex-1 overflow-y-auto px-8 py-6 space-y-5">

          {/* ── PANEL A: prompt input ── */}
          {view === "prompt" && (
            <>
              {/* Textarea */}
              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 block">
                  What changed?
                </label>
                <textarea
                  ref={textareaRef}
                  value={prompt}
                  onChange={e => setPrompt(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={isLoading}
                  rows={4}
                  maxLength={2000}
                  placeholder="e.g. Bryan joins as Mary's mentee — he's working on the company website"
                  className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-700 placeholder-slate-400 resize-none focus:outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 transition disabled:opacity-50 disabled:bg-slate-50"
                />
                <div className="flex justify-between items-center mt-1">
                  <p className="text-[10px] text-slate-400">⌘ Return to submit</p>
                  <p className={`text-[10px] ${prompt.length > 1800 ? "text-amber-500" : "text-slate-400"}`}>
                    {prompt.length} / 2000
                  </p>
                </div>
              </div>

              {/* Loading state */}
              {isLoading && (
                <div className="flex items-center gap-3 p-4 rounded-xl bg-violet-50 border border-violet-100">
                  <Loader2 className="w-5 h-5 animate-spin text-violet-500 flex-shrink-0" />
                  <p className="text-sm text-violet-700">Generating workflow patch…</p>
                </div>
              )}

              {/* Error */}
              {error && !isLoading && (
                <div className="flex items-start gap-3 p-4 rounded-xl bg-red-50 border border-red-100">
                  <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}

              {/* Examples */}
              {!isLoading && (
                <div>
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Examples</p>
                  <div className="space-y-1.5">
                    {EXAMPLES.map((ex, i) => (
                      <button key={i}
                        onClick={() => setPrompt(ex)}
                        className="w-full text-left text-xs text-slate-500 px-3 py-2 rounded-lg hover:bg-violet-50 hover:text-violet-700 transition-colors border border-transparent hover:border-violet-100">
                        "{ex}"
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── PANEL B: diff preview ── */}
          {view === "preview" && result && (
            <>
              {/* AI Summary */}
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-100">
                <p className="text-sm text-slate-600 leading-relaxed">{result.summary}</p>
              </div>

              {/* ── Additions ── */}
              {hasAdd && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-5 h-5 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
                      <Plus className="w-3 h-3 text-emerald-600" />
                    </div>
                    <h3 className="text-sm font-bold text-slate-800">Adding</h3>
                  </div>
                  <div className="space-y-2">
                    {result.add.nodes.map((n, i) => (
                      <div key={i} className="flex items-start gap-3 p-3 rounded-xl border border-emerald-100 bg-emerald-50/50">
                        <div className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0 border-2"
                          style={{ borderColor: ROLE_COLOR[n.role] ?? "#64748B", color: ROLE_COLOR[n.role] ?? "#64748B", background: "white" }}>
                          {n.initials || n.name.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-semibold text-slate-700">{n.name}</span>
                            <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full border ${ROLE_BADGE[n.role] ?? "bg-slate-50 text-slate-500 border-slate-200"}`}>
                              {n.role}
                            </span>
                          </div>
                          {n.summary && <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{n.summary}</p>}
                        </div>
                      </div>
                    ))}
                    {result.add.edges.map((e, i) => (
                      <div key={i} className="flex items-center gap-2 p-3 rounded-xl border border-emerald-100 bg-emerald-50/50">
                        <ArrowRight className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                        <span className="text-sm text-slate-600 font-medium">
                          <span className="text-emerald-700">{e.source}</span>
                          <span className="text-slate-400 mx-1">→</span>
                          <span className="text-emerald-700">{e.target}</span>
                          {e.name && <span className="text-slate-400 text-xs ml-2">"{e.name}"</span>}
                        </span>
                      </div>
                    ))}
                    {result.add.groups.map((g, i) => (
                      <div key={i} className="flex items-center gap-2 p-3 rounded-xl border border-emerald-100 bg-emerald-50/50">
                        <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: g.color }} />
                        <span className="text-sm font-semibold text-slate-700">{g.name}</span>
                        <span className="text-xs text-slate-400">Group · {g.nodeIds.length} member{g.nodeIds.length !== 1 ? "s" : ""}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Updates ── */}
              {hasUpdate && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-5 h-5 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                      <Pencil className="w-3 h-3 text-amber-600" />
                    </div>
                    <h3 className="text-sm font-bold text-slate-800">Updating</h3>
                  </div>
                  <div className="space-y-2">
                    {result.update.nodes.map((n, i) => {
                      const changedFields = Object.entries(n)
                        .filter(([k, v]) => k !== "id" && v !== undefined)
                        .map(([k]) => k);
                      return (
                        <div key={i} className="flex items-start gap-3 p-3 rounded-xl border border-amber-100 bg-amber-50/50">
                          <Pencil className="w-3.5 h-3.5 text-amber-600 flex-shrink-0 mt-0.5" />
                          <div className="min-w-0">
                            <span className="text-sm font-semibold text-slate-700">{n.name ?? n.id}</span>
                            <p className="text-xs text-slate-400 mt-0.5">
                              Updating: {changedFields.join(", ")}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                    {result.update.groupExtensions.map((ext, i) => {
                      const adds = ext.addNodeIds.length;
                      const removes = ext.removeNodeIds.length;
                      return (
                        <div key={i} className="flex items-start gap-3 p-3 rounded-xl border border-amber-100 bg-amber-50/50">
                          <Pencil className="w-3.5 h-3.5 text-amber-600 flex-shrink-0 mt-0.5" />
                          <div className="min-w-0">
                            <span className="text-sm font-semibold text-slate-700">Group: {ext.groupId}</span>
                            <p className="text-xs text-slate-400 mt-0.5">
                              {adds > 0    ? `+${adds} member${adds > 1 ? "s" : ""}` : ""}
                              {adds > 0 && removes > 0 ? "  ·  " : ""}
                              {removes > 0 ? `−${removes} member${removes > 1 ? "s" : ""}` : ""}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                    {(result.update.groups ?? []).map((g, i) => (
                      <div key={i} className="flex items-start gap-3 p-3 rounded-xl border border-amber-100 bg-amber-50/50">
                        <Pencil className="w-3.5 h-3.5 text-amber-600 flex-shrink-0 mt-0.5" />
                        <div className="min-w-0">
                          <span className="text-sm font-semibold text-slate-700">Group: {g.groupId}</span>
                          <p className="text-xs text-slate-400 mt-0.5">
                            {[g.name && `rename → "${g.name}"`, g.color && `recolor → ${g.color}`].filter(Boolean).join("  ·  ")}
                          </p>
                        </div>
                      </div>
                    ))}
                    {(result.update.nodeTasks ?? []).map((nt, i) => (
                      <div key={i} className="flex items-start gap-3 p-3 rounded-xl border border-amber-100 bg-amber-50/50">
                        <Pencil className="w-3.5 h-3.5 text-amber-600 flex-shrink-0 mt-0.5" />
                        <div className="min-w-0">
                          <span className="text-sm font-semibold text-slate-700">{nt.nodeId}</span>
                          <p className="text-xs text-slate-400 mt-0.5">
                            Replace tasks · {nt.tasks.length} task{nt.tasks.length !== 1 ? "s" : ""}
                          </p>
                        </div>
                      </div>
                    ))}
                    {(result.update.edges ?? []).map((e, i) => (
                      <div key={i} className="flex items-start gap-3 p-3 rounded-xl border border-amber-100 bg-amber-50/50">
                        <Pencil className="w-3.5 h-3.5 text-amber-600 flex-shrink-0 mt-0.5" />
                        <div className="min-w-0">
                          <span className="text-sm font-semibold text-slate-700">{e.id}</span>
                          <p className="text-xs text-slate-400 mt-0.5">
                            {e.name ? `rename → "${e.name}"` : "update edge metadata"}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Removals ── */}
              {hasRemove && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-5 h-5 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                      <Trash2 className="w-3 h-3 text-red-500" />
                    </div>
                    <h3 className="text-sm font-bold text-slate-800">Removing</h3>
                  </div>
                  <div className="space-y-2">
                    {result.remove.nodeIds.map((id, i) => (
                      <div key={i} className="flex items-center gap-2 p-3 rounded-xl border border-red-100 bg-red-50/50">
                        <Trash2 className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
                        <span className="text-sm font-semibold text-slate-700">{id}</span>
                        <span className="text-xs text-slate-400">node</span>
                      </div>
                    ))}
                    {result.remove.edgeIds.map((id, i) => (
                      <div key={i} className="flex items-center gap-2 p-3 rounded-xl border border-red-100 bg-red-50/50">
                        <Trash2 className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
                        <span className="text-sm text-slate-600">{id}</span>
                        <span className="text-xs text-slate-400">edge</span>
                      </div>
                    ))}
                    {(result.remove.groupIds ?? []).map((id, i) => (
                      <div key={i} className="flex items-center gap-2 p-3 rounded-xl border border-red-100 bg-red-50/50">
                        <Trash2 className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
                        <span className="text-sm font-semibold text-slate-700">{id}</span>
                        <span className="text-xs text-slate-400">group</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Empty state */}
              {!hasAdd && !hasUpdate && !hasRemove && (
                <div className="text-center py-6 text-slate-400 text-sm">
                  No changes were generated. Try rephrasing your update.
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="px-8 pb-6 pt-4 border-t border-slate-100 flex-shrink-0">
          {view === "prompt" ? (
            <button
              onClick={handleSubmit}
              disabled={!prompt.trim() || isLoading}
              className="w-full py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2">
              {isLoading
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating patch…</>
                : <><GitMerge className="w-4 h-4" /> Update Workflow</>
              }
            </button>
          ) : (
            <div className="flex gap-3">
              <button onClick={handleBack}
                className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-sm font-semibold hover:bg-slate-50 transition-colors">
                <ChevronLeft className="w-4 h-4" /> Back
              </button>
              <button
                onClick={() => result && onApply(result)}
                disabled={!result || (!hasAdd && !hasUpdate && !hasRemove)}
                className="flex-1 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2">
                <Plus className="w-4 h-4" /> Apply to Graph
              </button>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
