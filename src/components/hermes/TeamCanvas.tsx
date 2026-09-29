"use client";

/**
 * TeamCanvas — SVG map of the Hermes team: profiles as nodes, delegation as
 * edges, recent hand-offs as pulses. Colours come from the --h-* theme tokens
 * (globals.css), so the map follows the Hermes app's light/dark theme.
 *
 * Colour rules: indigo = working, red = failed/blocked, amber = needs
 * attention, green = replied. Selection is a neutral dashed outline.
 */

import { useMemo } from "react";
import type { DotStatus, HermesSnapshot, HermesTask } from "@/lib/hermes/types";
import { HUMAN_ID } from "@/lib/hermes/metrics";
import { NODE_H, NODE_W, edgePath, findEdgeFor, layoutTeam } from "@/lib/hermes/layout";
import { agentStatus, roleOf, shortName, statusText, TONE_VARS, type AgentStatus } from "@/lib/hermes/status";
import { useLanguage } from "@/contexts/LanguageContext";
import type { TranslationKey } from "@/lib/i18n";

export type HermesMode = "team" | "live" | "projects" | "replay";

export const DOT_COLORS: Record<DotStatus, string> = {
  todo: "#94A3B8",
  "in-progress": "#6366F1",
  review: "#0EA5E9",
  blocked: "#EF4444",
  done: "#10B981",
};
const DOT_ORDER: DotStatus[] = ["blocked", "in-progress", "review", "todo", "done"];
export const AGENT_COLORS = ["#0EA5E9", "#10B981", "#A855F7", "#EC4899", "#F59E0B", "#14B8A6"];
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

export function initials(name: string): string {
  const clean = name.replace(/^personal-/, "");
  const parts = clean.split(/[-_\s]+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : clean.slice(0, 2)).toUpperCase();
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/** Rough text width for 11px UI text, to size pills without measuring the DOM. */
function pillWidth(text: string): number {
  return Math.min(NODE_W - 24, Math.round(text.length * 6.1) + 26);
}

export function agentColor(snapshot: HermesSnapshot, id: string): string {
  const p = snapshot.profiles.find(x => x.id === id);
  if (!p) return "var(--h-text-2)";
  if (p.isDefault) return "#6366F1";
  const i = snapshot.profiles.filter(x => !x.isDefault).findIndex(x => x.id === id);
  return AGENT_COLORS[(i < 0 ? 0 : i) % AGENT_COLORS.length];
}

export function useStatusLabel() {
  const { t } = useLanguage();
  return (s: AgentStatus) => statusText(s, t(s.key as TranslationKey));
}

export function TeamCanvas({ snapshot, mode, selectedId, onSelect, replayFocus }: Props) {
  const { t } = useLanguage();
  const label = useStatusLabel();
  const layout = useMemo(() => layoutTeam(snapshot.profiles), [snapshot.profiles]);
  const profileIds = useMemo(() => new Set(snapshot.profiles.map(p => p.id)), [snapshot.profiles]);
  const tasksByNode = useMemo(() => {
    const map = new Map<string, HermesTask[]>();
    for (const task of snapshot.tasks) {
      if (!task.assignee || !profileIds.has(task.assignee)) continue;
      const list = map.get(task.assignee) ?? [];
      list.push(task);
      map.set(task.assignee, list);
    }
    for (const list of map.values()) list.sort((a, b) => DOT_ORDER.indexOf(a.dot) - DOT_ORDER.indexOf(b.dot));
    return map;
  }, [snapshot.tasks, profileIds]);

  const node = (id: string) => (id === HUMAN_ID || profileIds.has(id) ? id : HUMAN_ID);

  // One pulse per edge direction: the newest hand-off inside the window.
  const pulses = useMemo(() => {
    if (mode !== "live") return [];
    const seen = new Set<string>();
    const out: Array<{ key: string; edgeId: string; reverse: boolean }> = [];
    for (const e of snapshot.events) {
      if (!e.from || !e.to || snapshot.generatedAt - e.createdAt > PULSE_WINDOW_S) continue;
      const hit = findEdgeFor(snapshot.edges, node(e.from), node(e.to));
      if (!hit) continue;
      const k = `${hit.edge.id}:${hit.reverse}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ key: `${k}:${e.id}`, edgeId: hit.edge.id, reverse: hit.reverse });
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
  const bottleneckId = mode === "live" ? snapshot.bottleneck?.profileId : null;
  const boardProject = snapshot.board?.projectId ? snapshot.projects.find(p => p.id === snapshot.board?.projectId) : null;
  const mono = "ui-monospace, SFMono-Regular, Menlo, monospace";

  return (
    <svg viewBox={`0 0 ${layout.width} ${layout.height}`} className="block h-auto w-full" style={{ minWidth: 560 }}
      role="img" aria-label={t("hermes.canvas.aria")}>
      <defs>
        <marker id="h-arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" style={{ fill: "var(--h-faint)" }} />
        </marker>
        <marker id="h-arr-a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" style={{ fill: "var(--h-accent)" }} />
        </marker>
      </defs>

      {/* Board / project boundary around the workers */}
      {layout.workerBounds && (
        <g>
          <rect x={layout.workerBounds.x} y={layout.workerBounds.y} width={layout.workerBounds.w} height={layout.workerBounds.h} rx={16}
            style={{
              fill: mode === "projects" ? "var(--h-accent-soft)" : "none",
              stroke: mode === "projects" ? "var(--h-accent)" : "var(--h-border)",
            }}
            strokeWidth={mode === "projects" ? 1.6 : 1.2} strokeDasharray={mode === "projects" ? undefined : "5 5"} />
          <text x={layout.workerBounds.x + 16} y={layout.workerBounds.y + 20} fontSize={11} fontFamily={mono}
            style={{ fill: mode === "projects" ? "var(--h-accent)" : "var(--h-muted)" }}>
            {`${t("hermes.board")}: ${snapshot.board?.slug ?? "—"}`}
            {mode === "projects" && ` · ${boardProject ? `${t("hermes.project")} ${boardProject.name}` : t("hermes.projects.noProject")} · ${t("hermes.projects.shared")}`}
          </text>
        </g>
      )}

      {/* Edges */}
      {snapshot.edges.map(e => {
        const a = layout.nodes.get(e.source), b = layout.nodes.get(e.target);
        if (!a || !b) return null;
        const hot = replayEdge?.edge.id === e.id;
        const dim = mode === "replay" && replayFocus && !hot;
        const mx = (a.x + b.x) / 2 + NODE_W / 2, my = (a.y + NODE_H + b.y) / 2;
        return (
          <g key={e.id} opacity={dim ? 0.3 : 1}>
            <path id={`hp-${e.id}`} d={edgePath(a, b)} fill="none" style={{ stroke: hot ? "var(--h-accent)" : "var(--h-faint)" }}
              strokeWidth={hot ? 2.4 : 1.4} strokeDasharray={e.kind === "observed" ? "4 4" : e.kind === "chat" ? "1.5 4" : undefined}
              markerEnd={`url(#${hot ? "h-arr-a" : "h-arr"})`} />
            <path id={`hpr-${e.id}`} d={edgePath(b, a)} fill="none" stroke="none" />
            {mode === "team" && e.source !== HUMAN_ID && (
              <text x={mx + 6} y={my} fontSize={10.5} fontFamily={mono} style={{ fill: "var(--h-muted)" }}>{t("hermes.edge.delegates")}</text>
            )}
            {e.count > 0 && mode !== "team" && (
              <text x={mx + 6} y={my + 14} fontSize={10.5} fontFamily={mono} style={{ fill: "var(--h-muted)" }}>{`${e.count} ${t("hermes.edge.cards")}`}</text>
            )}
          </g>
        );
      })}
      {hub && layout.nodes.get(HUMAN_ID) && (
        <text x={layout.nodes.get(HUMAN_ID)!.x + NODE_W + 10} y={layout.nodes.get(HUMAN_ID)!.y + NODE_H / 2 - 8}
          fontSize={10.5} fontFamily={mono} style={{ fill: "var(--h-muted)" }}>{t("hermes.edge.requests")}</text>
      )}

      {/* Pulses */}
      <g className="hermes-anim">
        {pulses.map(p => (
          <circle key={p.key} r={4.5} style={{ fill: p.reverse ? "var(--h-ok)" : "var(--h-accent)" }}>
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
        const selected = selectedId === box.id;
        const st = !isHuman ? agentStatus(snapshot, box.id) : null;
        const tone = st ? TONE_VARS[st.tone] : TONE_VARS.idle;
        const working = !!st?.working;
        const bottleneck = bottleneckId === box.id;

        let stroke = "var(--h-border)";
        let strokeWidth = 1.2;
        if (working) { stroke = "var(--h-accent)"; strokeWidth = 2.6; }
        else if (mode === "live" && st?.tone === "bad") { stroke = "var(--h-bad)"; strokeWidth = 2; }
        else if (bottleneck) { stroke = "var(--h-warn)"; strokeWidth = 2; }

        const name = isHuman ? t("hermes.you") : profile ? shortName(profile) : box.id;
        const role = isHuman ? t("hermes.you.sub") : profile ? roleOf(profile) : "";
        const pill = isHuman ? null
          : mode === "team" ? { text: (profile?.model ?? t("hermes.defaultModel")).split("/").pop() ?? "", fg: "var(--h-muted)", bg: "var(--h-sunk)", icon: "" }
          : mode === "projects" ? { text: profile?.isDefault ? t("hermes.projects.crosses") : `${t("hermes.board")}: ${snapshot.board?.slug ?? "—"}`, fg: "var(--h-muted)", bg: "var(--h-sunk)", icon: "" }
          : st ? { text: label(st), fg: tone.fg, bg: tone.bg, icon: st.icon } : null;
        const pillText = pill ? truncate(`${pill.icon ? pill.icon + " " : ""}${pill.text}`, 30) : "";
        const tasks = tasksByNode.get(box.id) ?? [];
        const dots = mode === "live" || mode === "replay" ? tasks.slice(0, 5) : [];

        return (
          <g key={box.id} role="button" tabIndex={0} aria-label={`${name}${st ? `, ${label(st)}` : ""}`} aria-pressed={selected}
            className="cursor-pointer outline-none" opacity={involved(box.id) ? 1 : 0.35}
            onClick={() => onSelect(box.id)}
            onKeyDown={ev => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); onSelect(box.id); } }}>
            {selected && (
              <rect x={box.x - 5} y={box.y - 5} width={NODE_W + 10} height={NODE_H + 10} rx={16} fill="none"
                style={{ stroke: "var(--h-text-2)" }} strokeOpacity={0.55} strokeWidth={1.3} strokeDasharray="4 3" />
            )}
            {working && <rect x={box.x} y={box.y} width={NODE_W} height={NODE_H} rx={12} fill="none" className="hermes-working" />}
            {bottleneck && !working && <rect x={box.x} y={box.y} width={NODE_W} height={NODE_H} rx={12} fill="none" className="hermes-glow" />}
            <rect x={box.x} y={box.y} width={NODE_W} height={NODE_H} rx={12} style={{ fill: "var(--h-surface)", stroke }}
              strokeWidth={strokeWidth} className={working ? "hermes-working-border" : undefined} />

            <circle cx={box.x + 27} cy={box.y + 29} r={14} style={{ fill: isHuman ? "var(--h-text-2)" : agentColor(snapshot, box.id) }} />
            <text x={box.x + 27} y={box.y + 33} textAnchor="middle" fontSize={isHuman ? 9 : 11} fontWeight={700} fill="#FFFFFF">
              {isHuman ? "YOU" : initials(profile?.isDefault ? profile.name : box.id)}
            </text>
            <text x={box.x + 50} y={box.y + 26} fontSize={13.5} fontWeight={650} style={{ fill: "var(--h-text)" }}>{truncate(name, 18)}</text>
            <text x={box.x + 50} y={box.y + 42} fontSize={11.5} style={{ fill: "var(--h-muted)" }}>{truncate(role, 24)}</text>

            {pill && (
              <g>
                <rect x={box.x + 12} y={box.y + 57} width={pillWidth(pillText)} height={22} rx={11} style={{ fill: pill.bg }} />
                <text x={box.x + 24} y={box.y + 72} fontSize={11} fontWeight={600} style={{ fill: pill.fg }}>{pillText}</text>
              </g>
            )}
            {dots.map((task, i) => (
              <circle key={task.id} cx={box.x + NODE_W - 16 - i * 10} cy={box.y + 68} r={3.5} fill={DOT_COLORS[task.dot]}>
                <title>{`${task.title} · ${task.status}`}</title>
              </circle>
            ))}
          </g>
        );
      })}
    </svg>
  );
}
