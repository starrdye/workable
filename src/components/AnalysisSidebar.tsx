"use client";
import { useState, useEffect } from "react";
import { X, Zap, Link as LinkIcon, Trash2, Settings, Check, Clock, FastForward, Activity } from "lucide-react";

export interface AnalysisData {
  id: string;
  name: string;
  role: string;
  status: string;
  statusColor?: string;
  summary: string;
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
  metadataOverrides?: Record<string, Partial<AnalysisData>>;
}

const CORE_NODE_IDS = new Set(["nav", "script", "db", "xy", "mary", "ed", "cy"]);

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

      // Handle improvement-only flag (part of addEdge logic usually, but we can treat as an edge update)
      // For simplicity, we'll hit the metadata update again or just let it be.
      // Actually let's just use the metadata update to store it if needed, or if it's a custom edge, we might need a specific action.
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
