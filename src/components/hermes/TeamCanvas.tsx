"use client";

/**
 * TeamCanvas — SVG map of the Hermes team: profiles as nodes, delegation as
 * edges, cards as task dots, recent hand-offs as pulses along the edges.
 */

import { useMemo } from "react";
import type { DotStatus, HermesSnapshot, HermesTask, ProfileMetrics } from "@/lib/hermes/types";
import { HUMAN_ID, formatDuration } from "@/lib/hermes/metrics";
import { NODE_H, NODE_W, edgePath, findEdgeFor, layoutTeam } from "@/lib/hermes/layout";
import { useLanguage } from "@/contexts/LanguageContext";

export type HermesMode = "team" | "live" | "projects" | "replay";

export const DOT_COLORS: Record<DotStatus, string> = {
  todo: "#94A3B8",
  "in-progress": "#4F46E5",
  review: "#0EA5E9",
  blocked: "#EF4444",
  done: "#10B981",
};
const DOT_ORDER: DotStatus[] = ["blocked", "in-progress", "review", "todo", "done"];
const WORKER_COLORS = ["#0EA5E9", "#10B981", "#A855F7", "#EC4899", "#F59E0B", "#14B8A6"];
/** Hand-offs newer than this get a pulse in Live mode. */
export const PULSE_WINDOW_S = 10 * 60;

export interface ReplayFocus { from: string | null; to: string | null; at: string | null }

interface Props {
  snapshot: HermesSnapshot;
  mode: HermesMode;
  selectedId: string | null;
  onSelect: (id: string) => void;
  replayFocus?: ReplayFocus | null;
}

function initials(name: string): string {
  const parts = name.replace(/^personal-/, "").split(/[-_\s]+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : name.replace(/^personal-/, "").slice(0, 2)).toUpperCase();
}

function shortModel(model: string | null): string {
  if (!model) return "default model";
  const m = model.split("/").pop() ?? model;
  return m.length > 24 ? m.slice(0, 23) + "…" : m;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function heatStroke(m: ProfileMetrics | undefined): string | null {
  if (!m) return null;
  if (m.load >= 0.6) return "#EF4444";
  if (m.load >= 0.3) return "#F59E0B";
  return null;
}

export function TeamCanvas({ snapshot, mode, selectedId, onSelect, replayFocus }: Props) {
  const { t } = useLanguage();
  const layout = useMemo(() => layoutTeam(snapshot.profiles), [snapshot.profiles]);
  const profileIds = useMemo(() => new Set(snapshot.profiles.map(p => p.id)), [snapshot.profiles]);
  const metricsById = useMemo(() => new Map(snapshot.metrics.map(m => [m.profileId, m])), [snapshot.metrics]);
  const activityById = useMemo(() => new Map((snapshot.activity ?? []).map(a => [a.profileId, a])), [snapshot.activity]);
  const tasksByNode = useMemo(() => {
    const map = new Map<string, HermesTask[]>();
    for (const task of snapshot.tasks) {
      const node = task.assignee && profileIds.has(task.assignee) ? task.assignee : null;
      if (!node) continue;
      const list = map.get(node) ?? [];
      list.push(task);
      map.set(node, list);
    }
    for (const list of map.values()) list.sort((a, b) => DOT_ORDER.indexOf(a.dot) - DOT_ORDER.indexOf(b.dot));
    return map;
  }, [snapshot.tasks, profileIds]);

  const node = (id: string) => (id === HUMAN_ID || profileIds.has(id) ? id : HUMAN_ID);

  // One pulse per edge direction: the newest hand-off inside the window.
  const pulses = useMemo(() => {
    if (mode !== "live") return [];
    const seen = new Set<string>();
    const out: Array<{ key: string; edgeId: string; reverse: boolean; kind: string }> = [];
    for (const e of snapshot.events) {
      if (!e.from || !e.to || snapshot.generatedAt - e.createdAt > PULSE_WINDOW_S) continue;
      const hit = findEdgeFor(snapshot.edges, node(e.from), node(e.to));
      if (!hit) continue;
      const k = `${hit.edge.id}:${hit.reverse}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ key: `${k}:${e.id}`, edgeId: hit.edge.id, reverse: hit.reverse, kind: e.kind });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, snapshot.events, snapshot.edges, snapshot.generatedAt]);

  const replayEdge = useMemo(() => {
    if (mode !== "replay" || !replayFocus?.from || !replayFocus?.to) return null;
    return findEdgeFor(snapshot.edges, node(replayFocus.from), node(replayFocus.to));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, replayFocus, snapshot.edges]);

  const involved = (id: string): boolean => {
    if (mode !== "replay" || !replayFocus) return true;
    return [replayFocus.from, replayFocus.to, replayFocus.at].some(x => x && node(x) === id);
  };

  const hub = snapshot.profiles.find(p => p.isDefault);
  const workerColor = new Map(snapshot.profiles.filter(p => !p.isDefault).map((p, i) => [p.id, WORKER_COLORS[i % WORKER_COLORS.length]]));
  const bottleneckId = mode === "live" ? snapshot.bottleneck?.profileId : null;
  const boardProject = snapshot.board?.projectId ? snapshot.projects.find(p => p.id === snapshot.board?.projectId) : null;

  return (
    <svg viewBox={`0 0 ${layout.width} ${layout.height}`} className="w-full h-auto block" style={{ minWidth: 640 }}
      role="img" aria-label={t("hermes.canvas.aria")}>
      <defs>
        <marker id="h-arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="#94A3B8" />
        </marker>
        <marker id="h-arr-a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="#4F46E5" />
        </marker>
      </defs>

      {/* Board / project boundary around the workers */}
      {layout.workerBounds && (
        <g>
          <rect x={layout.workerBounds.x} y={layout.workerBounds.y} width={layout.workerBounds.w} height={layout.workerBounds.h} rx={14}
            fill={mode === "projects" ? "rgba(79,70,229,0.04)" : "none"}
            stroke={mode === "projects" ? "#4F46E5" : "#CBD5E1"} strokeWidth={mode === "projects" ? 1.6 : 1.2}
            strokeDasharray={mode === "projects" ? undefined : "5 5"} />
          <text x={layout.workerBounds.x + 16} y={layout.workerBounds.y + 20} fontSize={11} fontFamily="ui-monospace, monospace"
            fill={mode === "projects" ? "#4F46E5" : "#64748B"}>
            {`${t("hermes.board")}: ${snapshot.board?.slug ?? "—"}`}
            {mode === "projects" && ` · ${boardProject ? `${t("hermes.project")} ${boardProject.name}` : t("hermes.projects.noProject")} · ${t("hermes.projects.shared")}`}
          </text>
        </g>
      )}

      {/* Edges */}
      {snapshot.edges.map(e => {
        const a = layout.nodes.get(e.source), b = layout.nodes.get(e.target);
        if (!a || !b) return null;
        const d = edgePath(a, b);
        const hot = replayEdge?.edge.id === e.id;
        const dim = mode === "replay" && replayFocus && !hot;
        return (
          <g key={e.id} opacity={dim ? 0.3 : 1}>
            <path id={`hp-${e.id}`} d={d} fill="none" stroke={hot ? "#4F46E5" : "#94A3B8"} strokeWidth={hot ? 2.4 : 1.6}
              strokeDasharray={e.kind === "observed" ? "4 4" : e.kind === "chat" ? "1.5 4" : undefined}
              markerEnd={`url(#${hot ? "h-arr-a" : "h-arr"})`} />
            <path id={`hpr-${e.id}`} d={edgePath(b, a)} fill="none" stroke="none" />
            {mode === "team" && e.source !== HUMAN_ID && (() => {
              const mx = (a.x + b.x) / 2 + NODE_W / 2, my = (a.y + NODE_H + b.y) / 2;
              return <text x={mx + 6} y={my} fontSize={10.5} fill="#64748B" fontFamily="ui-monospace, monospace">{t("hermes.edge.delegates")}</text>;
            })()}
            {e.count > 0 && mode !== "team" && (() => {
              const mx = (a.x + b.x) / 2 + NODE_W / 2, my = (a.y + NODE_H + b.y) / 2;
              return <text x={mx + 6} y={my + 14} fontSize={10.5} fill="#64748B" fontFamily="ui-monospace, monospace">{`${e.count} ${t("hermes.edge.cards")}`}</text>;
            })()}
          </g>
        );
      })}
      {hub && layout.nodes.get(HUMAN_ID) && (
        <text x={layout.nodes.get(HUMAN_ID)!.x + NODE_W + 10} y={layout.nodes.get(HUMAN_ID)!.y + NODE_H / 2 - 8}
          fontSize={10.5} fill="#64748B" fontFamily="ui-monospace, monospace">{t("hermes.edge.requests")}</text>
      )}

      {/* Pulses */}
      <g className="hermes-anim">
        {pulses.map(p => (
          <circle key={p.key} r={5} fill={p.reverse ? "#10B981" : "#4F46E5"}>
            <animateMotion dur={p.reverse ? "3s" : "2.4s"} repeatCount="indefinite">
              <mpath href={`#${p.reverse ? "hpr" : "hp"}-${p.edgeId}`} />
            </animateMotion>
          </circle>
        ))}
      </g>

      {/* Nodes */}
      {[...layout.nodes.values()].map(box => {
        const isHuman = box.id === HUMAN_ID;
        const profile = snapshot.profiles.find(p => p.id === box.id);
        const m = metricsById.get(box.id);
        const tasks = tasksByNode.get(box.id) ?? [];
        const selected = selectedId === box.id;
        const name = isHuman ? t("hermes.you") : profile?.isDefault ? profile.name.replace(/^personal-/, "") : (profile?.id ?? box.id).replace(/^personal-/, "");
        const color = isHuman ? "#334155" : profile?.isDefault ? "#4F46E5" : workerColor.get(box.id) ?? "#64748B";
        const sub = isHuman ? t("hermes.you.sub") : profile?.isDefault ? `${t("hermes.orchestrator")} · ${shortModel(profile.model)}` : shortModel(profile?.model ?? null);
        const visibleDots = tasks.slice(0, 9);
        const blocked = tasks.filter(x => x.dot === "blocked").length;
        const running = tasks.filter(x => x.dot === "in-progress").length;
        const review = tasks.filter(x => x.dot === "review").length;
        const act = activityById.get(box.id);
        const turn = act?.lastTurn ?? null;
        const turnAgo = turn?.outcomeAt ? snapshot.generatedAt - turn.outcomeAt : null;
        const recentTurn = turnAgo != null && turnAgo < 3600;
        const ago = turnAgo != null ? formatDuration(turnAgo) : "";
        let status = "";
        let statusColor = "#64748B";
        if (act?.working) { status = `${t("hermes.status.replying")}${act.step ? ` · ${act.step}` : ""}`; statusColor = "#4F46E5"; }
        else if (blocked) { status = `${blocked} ${t("hermes.status.blocked")}`; statusColor = "#EF4444"; }
        else if (recentTurn && turn?.outcome === "failed") { status = t("hermes.status.failed").replace("{t}", ago); statusColor = "#EF4444"; }
        else if (recentTurn && turn?.outcome === "cut-off") { status = t("hermes.status.cutoff").replace("{t}", ago); statusColor = "#D97706"; }
        else if (recentTurn && turn?.outcome === "interrupted") { status = t("hermes.status.interrupted").replace("{t}", ago); statusColor = "#D97706"; }
        else if (review && profile?.isDefault) { status = `${review} ${t("hermes.status.inReview")}`; statusColor = m && m.load >= 0.3 ? "#D97706" : "#64748B"; }
        else if (running) status = `${running} ${t("hermes.status.running")}`;
        else if (recentTurn && turn?.outcome === "completed") { status = t("hermes.status.replied").replace("{t}", ago); statusColor = "#059669"; }
        else if (tasks.length) status = `${tasks.length} ${t("hermes.status.cards")}`;
        else status = t("hermes.status.idle");
        const failedRecently = mode === "live" && recentTurn && turn?.outcome === "failed";
        const stroke = selected ? "#4F46E5" : failedRecently ? "#EF4444" : mode === "live" ? heatStroke(m) ?? "#E2E8F0" : "#E2E8F0";

        return (
          <g key={box.id} role="button" tabIndex={0} aria-label={name} aria-pressed={selected}
            className="cursor-pointer outline-none" opacity={involved(box.id) ? 1 : 0.35}
            onClick={() => onSelect(box.id)}
            onKeyDown={ev => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); onSelect(box.id); } }}>
            {(mode === "live" || mode === "team") && act?.working && (
              <rect x={box.x} y={box.y} width={NODE_W} height={NODE_H} rx={12} fill="none" className="hermes-working" />
            )}
            {bottleneckId === box.id && (
              <rect x={box.x} y={box.y} width={NODE_W} height={NODE_H} rx={12} fill="none" className="hermes-glow" />
            )}
            <rect x={box.x} y={box.y} width={NODE_W} height={NODE_H} rx={12} fill="#FFFFFF" stroke={stroke}
              strokeWidth={selected || stroke !== "#E2E8F0" ? 2 : 1.2} />
            <circle cx={box.x + 28} cy={box.y + 30} r={14} fill={color} />
            <text x={box.x + 28} y={box.y + 34} textAnchor="middle" fontSize={isHuman ? 9 : 11} fontWeight={600} fill="#fff">
              {isHuman ? "YOU" : initials(profile?.isDefault ? profile.name : box.id)}
            </text>
            <text x={box.x + 50} y={box.y + 27} fontSize={13.5} fontWeight={600} fill="#1E293B">{truncate(name, 19)}</text>
            <text x={box.x + 50} y={box.y + 43} fontSize={10.5} fill="#64748B" fontFamily="ui-monospace, monospace">{truncate(sub, 22)}</text>

            {mode === "team" && act?.working && (
              <text x={box.x + NODE_W - 14} y={box.y + 20} textAnchor="end" fontSize={10} fill="#4F46E5" fontFamily="ui-monospace, monospace">{t("hermes.status.replying")}</text>
            )}
            {(mode === "live" || mode === "replay") && !isHuman && (
              <g>
                {visibleDots.map((task, i) => (
                  <circle key={task.id} cx={box.x + 18 + i * 11} cy={box.y + 70} r={4} fill={DOT_COLORS[task.dot]}>
                    <title>{`${task.title} · ${task.status}`}</title>
                  </circle>
                ))}
                <text x={box.x + 18 + Math.max(visibleDots.length, 0) * 11 + (visibleDots.length ? 4 : -4)} y={box.y + 74}
                  fontSize={10.5} fill={statusColor} fontFamily="ui-monospace, monospace">
                  {tasks.length > 9 ? `+${tasks.length - 9} · ` : ""}{status}
                </text>
              </g>
            )}
            {mode === "team" && !isHuman && profile && (
              <g>
                <rect x={box.x + 14} y={box.y + 62} width={profile.isDefault ? 44 : 80} height={18} rx={4} fill="#F1F5F9" />
                <text x={box.x + 20} y={box.y + 75} fontSize={10} fill="#334155" fontFamily="ui-monospace, monospace">
                  {profile.isDefault ? t("hermes.chip.lead") : profile.unattended ? t("hermes.chip.unattended") : t("hermes.chip.attended")}
                </text>
              </g>
            )}
            {mode === "projects" && !isHuman && profile && (
              <text x={box.x + 16} y={box.y + 74} fontSize={10.5} fill="#64748B" fontFamily="ui-monospace, monospace">
                {profile.isDefault ? t("hermes.projects.crosses") : `${t("hermes.board")}: ${snapshot.board?.slug ?? "—"}`}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

