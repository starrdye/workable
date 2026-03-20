"use client";
import { useState, useEffect } from "react";
import {
  X, Zap, Link as LinkIcon, Trash2, Settings, Check,
  Clock, FastForward, Activity, ShieldAlert, Plus, ChevronDown, ChevronUp,
} from "lucide-react";
import { CORE_NODE_IDS as CORE_NODE_IDS_ARRAY } from "@/lib/constants";
import type { NodeTask } from "@/lib/serverState";

export interface AnalysisData {
  id: string;
  name: string;
  role: string;
  status: string;
  statusColor?: string;
  summary: string;
  /** Operational / compliance / technical constraints for this entity. */
  constraints?: string;
  processes: string[];
  connections: string[];
  type: "node" | "edge";
  // Technical parameters
  sequence?: number;
  weight?: number;
  outputDelay?: number;
  isImprovementOnly?: boolean;
}

interface AnalysisSidebarProps {
  data: AnalysisData | null;
  isOpen: boolean;
  onClose: () => void;
  onDelete?: (id: string) => void;
  metadataOverrides?: Record<string, Partial<AnalysisData> & { tasks?: NodeTask[] }>;
}

const CORE_NODE_IDS = new Set<string>(CORE_NODE_IDS_ARRAY);

// ─── Status / priority helpers ──────────────────────────────────────────────

const STATUS_OPTIONS: NodeTask["status"][] = ["todo", "in-progress", "review", "blocked", "done"];
const PRIORITY_OPTIONS: NodeTask["priority"][] = ["low", "medium", "high"];

const STATUS_STYLE: Record<NodeTask["status"], string> = {
  "todo":        "bg-slate-100 text-slate-600",
  "in-progress": "bg-blue-100 text-blue-700",
  "review":      "bg-amber-100 text-amber-700",
  "blocked":     "bg-red-100 text-red-700",
  "done":        "bg-emerald-100 text-emerald-700 line-through",
};

const STATUS_DOT: Record<NodeTask["status"], string> = {
  "todo":        "bg-slate-400",
  "in-progress": "bg-blue-500",
  "review":      "bg-amber-400",
  "blocked":     "bg-red-500",
  "done":        "bg-emerald-500",
};

const PRIORITY_STYLE: Record<NodeTask["priority"], string> = {
  "low":    "text-slate-400 border-slate-200",
  "medium": "text-amber-500 border-amber-200",
  "high":   "text-red-500 border-red-200",
};

function nanoid() {
  return Math.random().toString(36).slice(2, 10);
}

// ─── Tasks section ──────────────────────────────────────────────────────────

function TasksSection({ nodeId, initialTasks }: { nodeId: string; initialTasks: NodeTask[] }) {
  const [tasks, setTasks] = useState<NodeTask[]>(initialTasks);
  const [adding, setAdding] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Form state for new task
  const emptyDraft = (): Omit<NodeTask, "id"> => ({
    title: "",
    status: "todo",
    priority: "medium",
    dueDate: "",
    note: "",
  });
  const [newTask, setNewTask] = useState(emptyDraft());

  // Edit state per task
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<NodeTask | null>(null);

  // Reset when node changes
  useEffect(() => {
    setTasks(initialTasks);
    setAdding(false);
    setExpandedId(null);
    setEditingId(null);
    setEditDraft(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId]);

  async function persistTasks(updated: NodeTask[]) {
    setTasks(updated);
    await fetch("/api/graph-state", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "updateMetadata",
        id: nodeId,
        metadata: { tasks: updated },
      }),
    }).catch(console.error);
  }

  function handleAddTask() {
    if (!newTask.title.trim()) return;
    const task: NodeTask = {
      id: nanoid(),
      title: newTask.title.trim(),
      status: newTask.status,
      priority: newTask.priority,
      ...(newTask.dueDate ? { dueDate: newTask.dueDate } : {}),
      ...(newTask.note?.trim() ? { note: newTask.note.trim() } : {}),
    };
    persistTasks([...tasks, task]);
    setNewTask(emptyDraft());
    setAdding(false);
  }

  function handleDeleteTask(id: string) {
    persistTasks(tasks.filter(t => t.id !== id));
    if (expandedId === id) setExpandedId(null);
    if (editingId === id) { setEditingId(null); setEditDraft(null); }
  }

  function startEdit(task: NodeTask) {
    setEditingId(task.id);
    setEditDraft({ ...task });
    setExpandedId(task.id);
  }

  function handleSaveEdit() {
    if (!editDraft || !editDraft.title.trim()) return;
    const updated = tasks.map(t => t.id === editDraft.id ? {
      ...editDraft,
      title: editDraft.title.trim(),
      dueDate: editDraft.dueDate?.trim() || undefined,
      note: editDraft.note?.trim() || undefined,
    } : t);
    persistTasks(updated);
    setEditingId(null);
    setEditDraft(null);
  }

  return (
    <div className="mt-6 pt-5 border-t border-slate-100">
      {/* Section header */}
      <div className="flex items-center justify-between mb-3">
        <div className="text-[10px] text-indigo-400 uppercase font-bold tracking-widest flex items-center gap-1.5">
          <Activity className="w-3 h-3" /> Tasks
          {tasks.length > 0 && (
            <span className="ml-1 bg-indigo-100 text-indigo-600 rounded-full px-1.5 py-px text-[9px] font-bold">
              {tasks.filter(t => t.status !== "done").length}/{tasks.length}
            </span>
          )}
        </div>
        <button
          onClick={() => { setAdding(a => !a); setExpandedId(null); setEditingId(null); }}
          className="flex items-center gap-1 text-[10px] font-semibold text-indigo-600 hover:text-indigo-800 border border-indigo-200 hover:bg-indigo-50 px-2 py-1 rounded-lg transition-colors"
        >
          <Plus className="w-3 h-3" /> Add Task
        </button>
      </div>

      {/* Add task form */}
      {adding && (
        <div className="mb-3 border border-indigo-100 rounded-xl p-3 bg-indigo-50/40 space-y-2">
          <input
            autoFocus
            type="text"
            placeholder="Task title…"
            value={newTask.title}
            onChange={e => setNewTask(d => ({ ...d, title: e.target.value }))}
            onKeyDown={e => { if (e.key === "Enter") handleAddTask(); if (e.key === "Escape") setAdding(false); }}
            className="w-full border border-indigo-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-indigo-400 bg-white"
          />
          <div className="flex gap-2">
            <select
              value={newTask.status}
              onChange={e => setNewTask(d => ({ ...d, status: e.target.value as NodeTask["status"] }))}
              className="flex-1 border border-indigo-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-indigo-400 bg-white"
            >
              {STATUS_OPTIONS.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <select
              value={newTask.priority}
              onChange={e => setNewTask(d => ({ ...d, priority: e.target.value as NodeTask["priority"] }))}
              className="flex-1 border border-indigo-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-indigo-400 bg-white"
            >
              {PRIORITY_OPTIONS.map(p => (
                <option key={p} value={p}>{p} priority</option>
              ))}
            </select>
          </div>
          <input
            type="date"
            value={newTask.dueDate || ""}
            onChange={e => setNewTask(d => ({ ...d, dueDate: e.target.value }))}
            className="w-full border border-indigo-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-indigo-400 bg-white text-slate-600"
          />
          <textarea
            rows={2}
            placeholder="Optional note…"
            value={newTask.note || ""}
            onChange={e => setNewTask(d => ({ ...d, note: e.target.value }))}
            className="w-full border border-indigo-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-indigo-400 bg-white resize-none"
          />
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => setAdding(false)}
              className="text-xs text-slate-500 hover:text-slate-700 px-3 py-1.5 rounded-lg hover:bg-slate-100 transition-colors"
            >Cancel</button>
            <button
              onClick={handleAddTask}
              disabled={!newTask.title.trim()}
              className="text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 px-3 py-1.5 rounded-lg transition-colors"
            >Add</button>
          </div>
        </div>
      )}

      {/* Task list */}
      {tasks.length === 0 && !adding ? (
        <div className="text-xs text-slate-400 italic py-1">No tasks yet — click "Add Task" to create one.</div>
      ) : (
        <ul className="space-y-1.5">
          {tasks.map(task => {
            const isExpanded = expandedId === task.id;
            const isEditing  = editingId  === task.id;
            const draft = isEditing ? editDraft! : task;

            return (
              <li key={task.id} className="border border-slate-100 rounded-xl overflow-hidden bg-white hover:border-slate-200 transition-colors">
                {/* Task row */}
                <div
                  className="flex items-center gap-2 px-3 py-2 cursor-pointer"
                  onClick={() => setExpandedId(isExpanded ? null : task.id)}
                >
                  <div className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[task.status]}`} />
                  <span className={`flex-1 text-xs font-medium truncate ${task.status === "done" ? "text-slate-400 line-through" : "text-slate-700"}`}>
                    {task.title}
                  </span>
                  <span className={`text-[9px] font-bold uppercase border rounded px-1.5 py-px ${PRIORITY_STYLE[task.priority]}`}>
                    {task.priority}
                  </span>
                  {isExpanded
                    ? <ChevronUp className="w-3 h-3 text-slate-300 shrink-0" />
                    : <ChevronDown className="w-3 h-3 text-slate-300 shrink-0" />}
                </div>

                {/* Expanded / edit view */}
                {isExpanded && (
                  <div className="px-3 pb-3 border-t border-slate-50 pt-2 space-y-2">
                    {isEditing ? (
                      <>
                        <input
                          autoFocus
                          type="text"
                          value={draft.title}
                          onChange={e => setEditDraft(d => d ? { ...d, title: e.target.value } : d)}
                          className="w-full border border-indigo-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-indigo-400 bg-white"
                        />
                        <div className="flex gap-2">
                          <select
                            value={draft.status}
                            onChange={e => setEditDraft(d => d ? { ...d, status: e.target.value as NodeTask["status"] } : d)}
                            className="flex-1 border border-indigo-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none bg-white"
                          >
                            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                          <select
                            value={draft.priority}
                            onChange={e => setEditDraft(d => d ? { ...d, priority: e.target.value as NodeTask["priority"] } : d)}
                            className="flex-1 border border-indigo-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none bg-white"
                          >
                            {PRIORITY_OPTIONS.map(p => <option key={p} value={p}>{p} priority</option>)}
                          </select>
                        </div>
                        <input
                          type="date"
                          value={draft.dueDate || ""}
                          onChange={e => setEditDraft(d => d ? { ...d, dueDate: e.target.value } : d)}
                          className="w-full border border-indigo-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none bg-white text-slate-600"
                        />
                        <textarea
                          rows={2}
                          placeholder="Optional note…"
                          value={draft.note || ""}
                          onChange={e => setEditDraft(d => d ? { ...d, note: e.target.value } : d)}
                          className="w-full border border-indigo-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none bg-white resize-none"
                        />
                        <div className="flex gap-2 justify-end">
                          <button
                            onClick={() => { setEditingId(null); setEditDraft(null); }}
                            className="text-xs text-slate-500 hover:text-slate-700 px-3 py-1.5 rounded-lg hover:bg-slate-100 transition-colors"
                          >Cancel</button>
                          <button
                            onClick={handleSaveEdit}
                            disabled={!draft.title.trim()}
                            className="text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1"
                          >
                            <Check className="w-3 h-3" /> Save
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${STATUS_STYLE[task.status]}`}>
                            {task.status}
                          </span>
                          {task.dueDate && (
                            <span className="flex items-center gap-1 text-[10px] text-slate-400">
                              <Clock className="w-3 h-3" /> {task.dueDate}
                            </span>
                          )}
                        </div>
                        {task.note && (
                          <p className="text-xs text-slate-500 leading-relaxed">{task.note}</p>
                        )}
                        <div className="flex gap-2 justify-end pt-1">
                          <button
                            onClick={(e) => { e.stopPropagation(); startEdit(task); }}
                            className="text-xs text-indigo-500 hover:text-indigo-700 px-2 py-1 rounded-lg hover:bg-indigo-50 transition-colors border border-indigo-100"
                          >Edit</button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDeleteTask(task.id); }}
                            className="text-xs text-red-400 hover:text-red-600 px-2 py-1 rounded-lg hover:bg-red-50 transition-colors border border-red-100"
                          >Delete</button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ─── Editable field helpers ──────────────────────────────────────────────────

function EditableField({
  label, value, editing,
  multiline = false, onChange,
  type = "text",
}: {
  label: string; value: string | number; editing: boolean;
  multiline?: boolean; onChange: (v: string) => void;
  type?: "text" | "number";
}) {
  if (!editing) {
    return (
      <div className="mb-4">
        <div className="text-[10px] text-slate-400 uppercase font-semibold tracking-widest mb-1">{label}</div>
        <div className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{value ?? <span className="italic text-slate-400">—</span>}</div>
      </div>
    );
  }
  return (
    <div className="mb-4">
      <label className="text-[10px] text-slate-400 uppercase font-semibold tracking-widest mb-1 block">{label}</label>
      {multiline ? (
        <textarea rows={3} value={value}
          onChange={e => onChange(e.target.value)}
          className="w-full border border-indigo-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400 resize-none bg-indigo-50/30" />
      ) : (
        <input type={type} value={value}
          step={type === "number" ? "0.1" : undefined}
          onChange={e => onChange(e.target.value)}
          className="w-full border border-indigo-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400 bg-indigo-50/30" />
      )}
    </div>
  );
}

function EditableList({
  label, items, editing, onChange,
}: {
  label: string; items: string[]; editing: boolean; onChange: (v: string[]) => void;
}) {
  if (!editing) {
    return (
      <div className="mb-4">
        <div className="text-[10px] text-slate-400 uppercase font-semibold tracking-widest mb-2 border-b border-slate-100 pb-1">{label}</div>
        <ul className="text-sm text-slate-700 space-y-1.5">
          {items.map((p, i) => (
            <li key={i} className="flex items-start gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 mt-1.5 shrink-0" />
              {p}
            </li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <div className="mb-4">
      <div className="text-[10px] text-slate-400 uppercase font-semibold tracking-widest mb-1 border-b border-slate-100 pb-1">{label}</div>
      <div className="text-[10px] text-slate-400 mb-1">One item per line</div>
      <textarea rows={Math.max(3, items.length + 1)} value={items.join("\n")}
        onChange={e => onChange(e.target.value.split("\n"))}
        className="w-full border border-indigo-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400 resize-none bg-indigo-50/30 font-mono" />
    </div>
  );
}

// ─── Main sidebar ────────────────────────────────────────────────────────────

export function AnalysisSidebar({ data, isOpen, onClose, onDelete, metadataOverrides }: AnalysisSidebarProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<AnalysisData | null>(null);
  const [saving, setSaving] = useState(false);

  // Merge overrides into the displayed data
  const displayed: AnalysisData | null = data ? {
    ...data,
    ...(metadataOverrides?.[data.id] || {}),
  } : null;

  // Reset draft when selection changes
  useEffect(() => {
    setEditing(false);
    setDraft(displayed ? { ...displayed } : null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.id]);

  const canDelete = displayed && onDelete && displayed.type === "node" && !CORE_NODE_IDS.has(displayed.id);

  const handleSave = async () => {
    if (!draft || !displayed) return;
    setSaving(true);

    // 1. Update primary metadata
    await fetch("/api/graph-state", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "updateMetadata",
        id: displayed.id,
        metadata: {
          name: draft.name,
          role: draft.role,
          status: draft.status,
          statusColor: draft.statusColor,
          summary: draft.summary,
          constraints: draft.constraints,
          processes: (draft.processes || []).filter(Boolean),
          connections: (draft.connections || []).filter(Boolean),
        },
      }),
    }).catch(console.error);

    // 2. Update technical parameters
    if (displayed.type === "edge") {
      await fetch("/api/graph-state", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "updateEdgeParams",
          edgeId: displayed.id,
          sequence: draft.sequence,
          weight: draft.weight,
          isImprovementOnly: draft.isImprovementOnly,
        }),
      }).catch(console.error);
    } else {
      await fetch("/api/graph-state", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "updateNodeDelay",
          nodeId: displayed.id,
          delay: draft.outputDelay,
        }),
      }).catch(console.error);
    }

    setSaving(false);
    setEditing(false);
  };

  const set = (field: keyof AnalysisData) => (val: any) =>
    setDraft(d => d ? { ...d, [field]: val } : d);

  const current = editing ? draft : displayed;

  // Tasks for current node
  const nodeTasks: NodeTask[] = (data?.id && metadataOverrides?.[data.id]?.tasks) ? metadataOverrides[data.id].tasks! : [];

  return (
    <aside className={`absolute right-0 top-0 w-80 h-full bg-white border-l border-gray-200 shadow-2xl z-50 flex flex-col transform transition-transform duration-300 ${isOpen ? "translate-x-0" : "translate-x-full"}`}>
      {/* Header */}
      <div className="px-5 py-4 border-b border-gray-100 flex justify-between items-center bg-slate-50 shrink-0">
        <h3 className="font-bold text-slate-800 flex items-center gap-2 text-sm">
          {displayed?.type === "node"
            ? <Zap className="w-4 h-4 text-indigo-600" />
            : <LinkIcon className="w-4 h-4 text-indigo-600" />}
          {displayed?.type === "node" ? "Node Analysis" : "Relation Analysis"}
        </h3>
        <div className="flex items-center gap-2">
          {displayed && (
            editing ? (
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-1 text-xs font-semibold text-emerald-600 hover:text-emerald-700 border border-emerald-200 hover:bg-emerald-50 px-2 py-1 rounded-lg transition-colors disabled:opacity-50"
              >
                <Check className="w-3.5 h-3.5" />
                {saving ? "Saving…" : "Save"}
              </button>
            ) : (
              <button
                onClick={() => { setDraft(displayed ? { ...displayed } : null); setEditing(true); }}
                title="Edit fields"
                className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-400 hover:text-indigo-600 transition-colors"
              >
                <Settings className="w-4 h-4" />
              </button>
            )
          )}
          <button onClick={() => { setEditing(false); onClose(); }} className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-400 hover:text-slate-700 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="p-5 overflow-y-auto flex-1">
        {!current ? (
          <div className="text-sm text-slate-400 italic mt-2">Select a node or connection to view details.</div>
        ) : (
          <>
            {editing && (
              <div className="mb-4 text-xs text-indigo-500 bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2 font-medium">
                ✏️ Editing — changes are saved to the server session. Export CSV to persist permanently.
              </div>
            )}

            <EditableField label={current.type === "node" ? "Entity Name" : "Connection Name"}
              value={current.name || (current.type === "node" ? "Custom Node" : "Connection")}
              editing={editing} onChange={set("name")} />

            <EditableField label={current.type === "node" ? "Role / Type" : "Transfer Method"}
              value={current.role || "User Added"}
              editing={editing} onChange={set("role")} />

            <EditableField label="System Status"
              value={current.status || "Active"}
              editing={editing} onChange={set("status")} />

            {!editing && (
              <div className="mb-4">
                <div className="text-[10px] text-slate-400 uppercase font-semibold tracking-widest mb-1">Status</div>
                <span className={`text-sm font-bold ${current.statusColor || "text-indigo-600"}`}>{current.status || "Active"}</span>
              </div>
            )}

            {/* Technical Parameters Section */}
            <div className="mt-6 mb-6 pt-4 border-t border-slate-100">
              <div className="text-[10px] text-indigo-400 uppercase font-bold tracking-widest mb-4 flex items-center gap-2">
                <Activity className="w-3 h-3" /> Technical Parameters
              </div>

              {current.type === "node" ? (
                <div className="grid grid-cols-1 gap-4">
                  <div className="flex items-center gap-3">
                    <Clock className="w-4 h-4 text-slate-400 shrink-0" />
                    <div className="flex-1">
                      <EditableField
                        label="Output Delay Multiplier"
                        value={current.outputDelay ?? 1}
                        editing={editing}
                        type="number"
                        onChange={v => set("outputDelay")(parseFloat(v) || 1)}
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex items-start gap-3">
                    <FastForward className="w-4 h-4 text-slate-400 shrink-0 mt-1" />
                    <div className="flex-1">
                      <EditableField
                        label="Sequence"
                        value={current.sequence ?? 1}
                        editing={editing}
                        type="number"
                        onChange={v => set("sequence")(parseInt(v) || 1)}
                      />
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Activity className="w-4 h-4 text-slate-400 shrink-0 mt-1" />
                    <div className="flex-1">
                      <EditableField
                        label="Weight"
                        value={current.weight ?? 1}
                        editing={editing}
                        type="number"
                        onChange={v => set("weight")(parseFloat(v) || 1)}
                      />
                    </div>
                  </div>
                </div>
              )}

              {current.type === "edge" && (
                <div className="mt-2">
                  {editing ? (
                    <label className="flex items-center gap-2 cursor-pointer pt-2 group">
                      <input
                        type="checkbox"
                        checked={!!current.isImprovementOnly}
                        onChange={e => set("isImprovementOnly")(e.target.checked)}
                        className="w-4 h-4 rounded border-indigo-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <span className="text-xs font-semibold text-slate-600 group-hover:text-indigo-600 transition-colors">Optimized Route (Improvements Only)</span>
                    </label>
                  ) : (
                    current.isImprovementOnly && (
                      <div className="inline-flex items-center gap-1.5 bg-emerald-50 text-emerald-600 px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider">
                        <Check className="w-3 h-3" /> Optimized Route
                      </div>
                    )
                  )}
                </div>
              )}
            </div>

            <EditableField label="Summary"
              value={current.summary || (current.type === "node" ? "No summary provided." : "Direct communication between nodes.")}
              editing={editing} multiline onChange={set("summary")} />

            {/* Constraints — only shown for nodes */}
            {current.type === "node" && (
              <div className="mb-4">
                <div className="flex items-center gap-1.5 mb-1">
                  <ShieldAlert className="w-3 h-3 text-amber-500" />
                  <span className="text-[10px] text-slate-400 uppercase font-semibold tracking-widest">Constraints</span>
                </div>
                {editing ? (
                  <textarea
                    rows={3}
                    value={current.constraints || ""}
                    placeholder="e.g. Requires manual sign-off · GDPR restricted · Max 500 req/day"
                    onChange={(e) => set("constraints")(e.target.value)}
                    className="w-full border border-amber-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-400 resize-none bg-amber-50/30"
                  />
                ) : current.constraints ? (
                  <div className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                    {current.constraints}
                  </div>
                ) : (
                  <div className="text-sm text-slate-400 italic">None set — click edit to add constraints.</div>
                )}
              </div>
            )}

            <EditableList
              label={current.type === "node" ? "Assigned Processes" : "Active Protocols"}
              items={current.processes || []} editing={editing}
              onChange={val => setDraft(d => d ? { ...d, processes: val } : d)} />

            <EditableList
              label={current.type === "node" ? "Direct Connections" : "Connected Nodes"}
              items={current.connections || []} editing={editing}
              onChange={val => setDraft(d => d ? { ...d, connections: val } : d)} />

            {editing && current.type === "node" && (
              <p className="mt-1 text-[10px] text-slate-400 italic">
                Note: This list is for documentation. To create an interactive path on the graph, use the <b>"Connect from here"</b> tool on the canvas.
              </p>
            )}

            {/* Tasks — only for nodes, always visible (independent of edit mode) */}
            {current.type === "node" && data?.id && (
              <TasksSection key={data.id} nodeId={data.id} initialTasks={nodeTasks} />
            )}

            {/* Delete */}
            {canDelete && !editing && (
              <button
                onClick={() => onDelete!(displayed!.id)}
                className="mt-6 w-full flex items-center justify-center gap-2 text-sm font-semibold text-red-500 border border-red-200 hover:bg-red-50 py-2 rounded-xl transition-colors"
              >
                <Trash2 className="w-4 h-4" />
                Delete Node
              </button>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
