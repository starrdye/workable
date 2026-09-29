"use client";

/**
 * WorkflowCard — compact, read-only drawing of a stored workflow graph.
 * Rendered at /embed/graph/[id]; the Hermes chat card frames that page.
 */

import { useEffect, useMemo, useState } from "react";
import { toCanvasImport, type WorkflowGraph } from "@/lib/workflowGraph";

const ROLE_COLORS: Record<string, string> = {
  person: "#6366F1",
  tool: "#0EA5E9",
  external: "#EC4899",
  output: "#10B981",
};
const R = 18;
const PAD = 46;

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

export function WorkflowCard({ id }: { id: string }) {
  const [graph, setGraph] = useState<WorkflowGraph | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pushed, setPushed] = useState<"idle" | "busy" | "done" | "failed">("idle");

  useEffect(() => {
    fetch(`/api/graphs/${encodeURIComponent(id)}`, { cache: "no-store" })
      .then(async res => {
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
        setGraph(body as WorkflowGraph);
      })
      .catch(err => setError(err instanceof Error ? err.message : String(err)));
  }, [id]);

  const view = useMemo(() => {
    if (!graph) return null;
    const meta = graph.metadataOverrides ?? {};
    const pos = (nid: string) => graph.baselinePositions[nid] ?? graph.customNodes.find(n => n.id === nid)?.position ?? { x: 0, y: 0 };
    const nodes = graph.customNodes.map(n => ({ id: n.id, ...pos(n.id), name: meta[n.id]?.name ?? n.label, role: meta[n.id]?.role ?? n.role, initials: n.labelInitials }));
    if (!nodes.length) return null;
    const xs = nodes.map(n => n.x), ys = nodes.map(n => n.y);
    const minX = Math.min(...xs) - PAD, minY = Math.min(...ys) - PAD - 14, maxX = Math.max(...xs) + PAD, maxY = Math.max(...ys) + PAD + 14;
    const byId = new Map(nodes.map(n => [n.id, n]));
    const groups = (graph.workflowGroups ?? []).filter(g => !g.parentGroupId).flatMap(g => {
      const members = g.nodeIds.map(nid => byId.get(nid)).filter(Boolean) as typeof nodes;
      if (!members.length) return [];
      const gx = members.map(m => m.x), gy = members.map(m => m.y);
      return [{ id: g.id, name: g.name, color: g.color, x: Math.min(...gx) - 34, y: Math.min(...gy) - 40, w: Math.max(...gx) - Math.min(...gx) + 68, h: Math.max(...gy) - Math.min(...gy) + 84 }];
    });
    const edges = graph.customEdges.flatMap(e => {
      const a = byId.get(e.source), b = byId.get(e.target);
      if (!a || !b) return [];
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
      return [{ id: e.id, x1: a.x + (dx / len) * R, y1: a.y + (dy / len) * R, x2: b.x - (dx / len) * (R + 4), y2: b.y - (dy / len) * (R + 4) }];
    });
    const topGroups = (graph.workflowGroups ?? []).filter(g => !g.parentGroupId).length;
    return { nodes, groups, edges, box: `${minX} ${minY} ${maxX - minX} ${maxY - minY}`, stats: { steps: nodes.length, handoffs: edges.length, phases: topGroups } };
  }, [graph]);

  async function showOnCanvas() {
    if (!graph) return;
    setPushed("busy");
    try {
      const res = await fetch("/api/graph-state", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(toCanvasImport(graph)) });
      setPushed(res.ok ? "done" : "failed");
    } catch {
      setPushed("failed");
    }
  }

  return (
    <div className="flex h-screen flex-col bg-white text-slate-800 dark:bg-slate-900 dark:text-slate-100">
      <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2 text-[12px] dark:border-slate-700">
        <span className="h-3 w-3 rounded-[3px] bg-indigo-600" aria-hidden="true" />
        <span className="font-semibold">Workable</span>
        {view && (
          <span className="text-slate-500 dark:text-slate-400">
            {view.stats.steps} steps · {view.stats.handoffs} hand-offs{view.stats.phases ? ` · ${view.stats.phases} phases` : ""}
          </span>
        )}
        <span className="flex-1" />
        {graph && (
          <button type="button" onClick={showOnCanvas} disabled={pushed === "busy"}
            className="rounded-md border border-indigo-300 bg-indigo-50 px-2 py-0.5 text-[12px] font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-60 dark:border-indigo-500/50 dark:bg-indigo-500/10 dark:text-indigo-300">
            {pushed === "done" ? "On the canvas ✓" : pushed === "failed" ? "Couldn't reach Workable" : "Show on canvas"}
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1">
        {error && <p className="p-4 text-[13px] text-red-600">{error}</p>}
        {!error && !view && <p className="p-4 text-[13px] text-slate-500">Loading workflow…</p>}
        {view && (
          <svg viewBox={view.box} preserveAspectRatio="xMidYMid meet" className="h-full w-full" role="img" aria-label={`Workflow with ${view.stats.steps} steps`}>
            <defs>
              <marker id="wc-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" className="fill-slate-400" />
              </marker>
            </defs>
            {view.groups.map(g => (
              <g key={g.id}>
                <rect x={g.x} y={g.y} width={g.w} height={g.h} rx={14} fill={g.color} fillOpacity={0.08} stroke={g.color} strokeOpacity={0.45} strokeDasharray="5 4" />
                <text x={g.x + 10} y={g.y + 16} fontSize={12} fontWeight={600} fill={g.color}>{truncate(g.name, 28)}</text>
              </g>
            ))}
            {view.edges.map(e => (
              <line key={e.id} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} className="stroke-slate-400" strokeWidth={1.4} markerEnd="url(#wc-arrow)" />
            ))}
            {view.nodes.map(n => (
              <g key={n.id}>
                <title>{n.name}</title>
                <circle cx={n.x} cy={n.y} r={R} className="fill-white dark:fill-slate-900" stroke={ROLE_COLORS[n.role] ?? "#64748B"} strokeWidth={2} />
                <text x={n.x} y={n.y + 4} textAnchor="middle" fontSize={11} fontWeight={700} fill={ROLE_COLORS[n.role] ?? "#64748B"}>{n.initials}</text>
                <text x={n.x} y={n.y + R + 14} textAnchor="middle" fontSize={11} className="fill-slate-700 dark:fill-slate-200">{truncate(n.name, 22)}</text>
              </g>
            ))}
          </svg>
        )}
      </div>
    </div>
  );
}
