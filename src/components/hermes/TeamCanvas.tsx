"use client";

/**
 * TeamCanvas — SVG map of the Hermes team: profiles as nodes, delegation as
 * edges. Colours come from the --h-* theme tokens (globals.css), so the map
 * follows the Hermes app's light/dark theme.
 *
 * No looping animation: each agent shows one solid status block (Waiting,
 * Working, Replied, Failed, Review) and, in Live mode, each edge takes the
 * colour of the latest request along it. Selection is a neutral dashed outline.
 */

import { useMemo } from "react";
import type { DotStatus, HermesSnapshot, HermesTask } from "@/lib/hermes/types";
import { HUMAN_ID } from "@/lib/hermes/metrics";
import { NODE_H, NODE_W, edgePath, findEdgeFor, layoutTeam, treeBranch } from "@/lib/hermes/layout";
import { agentStatus, requestRows, REQUEST_TONE, roleOf, shortName, statusText, TONE_VARS, type AgentStatus, type StatusTone } from "@/lib/hermes/status";
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
/** Avatar colour for you (the human): a fixed neutral that reads in light and dark. */
export const YOU_COLOR = "#676879";
export const AGENT_COLORS = ["#0EA5E9", "#10B981", "#A855F7", "#EC4899", "#F59E0B", "#14B8A6"];
/** Requests newer than this colour their edge in Live mode. */
export const EDGE_WINDOW_S = 60 * 60;

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
  return Math.min(NODE_W - 24, Math.round(text.length * 6.4) + 22);
}

export function agentColor(snapshot: HermesSnapshot, id: string): string {
  const p = snapshot.profiles.find(x => x.id === id);
  if (!p) return YOU_COLOR;
  if (p.isDefault) return "#6366F1";
  const i = snapshot.profiles.filter(x => !x.isDefault).findIndex(x => x.id === id);
  return AGENT_COLORS[(i < 0 ? 0 : i) % AGENT_COLORS.length];
}

export function useStatusLabel() {
  const { t } = useLanguage();
  return (s: AgentStatus) => statusText(s, t(s.key as TranslationKey));
}

/** The quiet text next to a status block: what it's doing now, or how long ago. */
export function useStatusSub() {
  const { t } = useLanguage();
  return (s: AgentStatus) => (s.working ? s.step ?? "" : s.ago ? t("hermes.req.ago").replace("{t}", s.ago) : "");
}

export function TeamCanvas({ snapshot, mode, selectedId, onSelect, replayFocus }: Props) {
  const { t } = useLanguage();
  const label = useStatusLabel();
  const sub = useStatusSub();
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

  // Live mode: each edge takes the colour of the newest request along it.
  const edgeTone = useMemo(() => {
    const out = new Map<string, StatusTone>();
    if (mode !== "live") return out;
    for (const r of requestRows(snapshot, EDGE_WINDOW_S)) {
      const hit = findEdgeFor(snapshot.edges, node(r.from), node(r.to));
      if (hit && !out.has(hit.edge.id)) out.set(hit.edge.id, REQUEST_TONE[r.state]);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, snapshot]);

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
  const boardProject = snapshot.board?.projectId ? snapshot.projects.find(p => p.id === snapshot.board?.projectId) : null;
  const labelFont = "inherit";

  return (
    <svg viewBox={`0 0 ${layout.width} ${layout.height}`} className="block h-auto w-full" style={{ minWidth: 560 }}
      role="img" aria-label={t("hermes.canvas.aria")}>
      <defs>
        {/* Small arrowheads that match their line: neutral, replay accent, and one per status colour */}
        {([["n", "var(--h-faint)"], ["a", "var(--h-accent)"], ...(Object.keys(TONE_VARS) as StatusTone[]).map(k => [k, TONE_VARS[k].bar])] as const).map(([id, fill]) => (
          <marker key={id} id={`h-arr-${id}`} viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
            <path d="M1,1.5 L8.5,5 L1,8.5 z" style={{ fill }} />
          </marker>
        ))}
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
          <text x={layout.workerBounds.x + 16} y={layout.workerBounds.y + 20} fontSize={11} fontFamily={labelFont}
            style={{ fill: mode === "projects" ? "var(--h-accent)" : "var(--h-muted)" }}>
            {`${t("hermes.board")}: ${snapshot.board?.slug ?? "—"}`}
            {mode === "projects" && ` · ${boardProject ? `${t("hermes.project")} ${boardProject.name}` : t("hermes.projects.noProject")} · ${t("hermes.projects.shared")}`}
          </text>
        </g>
      )}

      {/* Edges: org-chart connectors from the orchestrator (neutral trunk, one
          drop per worker coloured by its latest request), a straight line from
          You to the orchestrator. Direct You → worker chats aren't drawn; the
          Requests table lists them. */}
      {hub && layout.nodes.get(hub.id) && (() => {
        const hb = layout.nodes.get(hub.id)!;
        const first = snapshot.edges.find(e => e.source === hub.id && layout.nodes.get(e.target));
        return first ? <path d={treeBranch(hb, layout.nodes.get(first.target)!).trunk} fill="none" style={{ stroke: "var(--h-faint)" }} strokeWidth={1.5} /> : null;
      })()}
      {snapshot.edges.map(e => {
        const a = layout.nodes.get(e.source), b = layout.nodes.get(e.target);
        if (!a || !b || e.kind === "chat") return null;
        const hot = replayEdge?.edge.id === e.id;
        const tone = edgeTone.get(e.id);
        const color = hot ? "var(--h-accent)" : tone ? TONE_VARS[tone].bar : null;
        const marker = `url(#h-arr-${hot ? "a" : tone ?? "n"})`;
        const dim = mode === "replay" && replayFocus && !hot;
        const count = e.count > 0 && (mode === "projects" || mode === "replay") ? `${e.count} ${t("hermes.edge.cards")}` : null;

        if (hub && e.source === hub.id) {
          const tb = treeBranch(a, b);
          return (
            <g key={e.id} opacity={dim ? 0.3 : 1}>
              <path d={tb.branch} fill="none" style={{ stroke: "var(--h-faint)" }} strokeWidth={1.5} markerEnd={color ? undefined : marker} />
              {color && <path d={tb.drop} fill="none" style={{ stroke: color }} strokeWidth={2.5} strokeLinecap="round" markerEnd={marker} />}
              {count && <text x={tb.label.x} y={tb.label.y} fontSize={10.5} fontFamily={labelFont} style={{ fill: "var(--h-muted)" }}>{count}</text>}
            </g>
          );
        }
        return (
          <g key={e.id} opacity={dim ? 0.3 : 1}>
            <path d={edgePath(a, b)} fill="none" style={{ stroke: color ?? "var(--h-faint)" }} strokeWidth={color ? 2.5 : 1.5}
              strokeDasharray={!color && e.kind === "observed" ? "4 4" : undefined} markerEnd={marker} />
            {count && <text x={(a.x + b.x) / 2 + NODE_W / 2 + 6} y={(a.y + NODE_H + b.y) / 2 + 14} fontSize={10.5} fontFamily={labelFont} style={{ fill: "var(--h-muted)" }}>{count}</text>}
          </g>
        );
      })}
      {hub && layout.nodes.get(HUMAN_ID) && (
        <text x={layout.nodes.get(HUMAN_ID)!.x + NODE_W + 12} y={layout.nodes.get(HUMAN_ID)!.y + NODE_H / 2 - 8}
          fontSize={10.5} fontFamily={labelFont} style={{ fill: "var(--h-muted)" }}>{t("hermes.edge.requests")}</text>
      )}
      {mode === "team" && hub && layout.nodes.get(hub.id) && (
        <text x={layout.nodes.get(hub.id)!.x + NODE_W / 2 + 8} y={layout.nodes.get(hub.id)!.y + NODE_H + 28}
          fontSize={10.5} fontFamily={labelFont} style={{ fill: "var(--h-muted)" }}>{t("hermes.edge.delegates")}</text>
      )}

      {/* Nodes */}
      {[...layout.nodes.values()].map(box => {
        const isHuman = box.id === HUMAN_ID;
        const profile = snapshot.profiles.find(p => p.id === box.id);
        const selected = selectedId === box.id;
        const st = !isHuman ? agentStatus(snapshot, box.id) : null;
        const tone = st ? TONE_VARS[st.tone] : TONE_VARS.idle;
        const working = !!st?.working;

        const showStatus = mode === "live" || mode === "replay";
        const strong = showStatus && working; // only "working right now" gets a coloured border
        // The bottleneck is explained in the side panel; a border colour here would
        // clash with the status colours (orange = working).
        const stroke = strong ? tone.bar : "var(--h-border)";
        const strokeWidth = strong ? 2 : 1.2;

        const name = isHuman ? t("hermes.you") : profile ? shortName(profile) : box.id;
        const role = isHuman ? t("hermes.you.sub") : profile ? roleOf(profile) : "";
        const pill = isHuman ? null
          : mode === "team" ? { text: (profile?.model ?? t("hermes.defaultModel")).split("/").pop() ?? "", fg: "var(--h-muted)", bg: "var(--h-sunk)", icon: "" }
          : mode === "projects" ? { text: profile?.isDefault ? t("hermes.projects.crosses") : `${t("hermes.board")}: ${snapshot.board?.slug ?? "—"}`, fg: "var(--h-muted)", bg: "var(--h-sunk)", icon: "" }
          : st ? { text: label(st), fg: tone.fg, bg: tone.bg, icon: "" } : null;
        const pillText = pill ? truncate(pill.text, 26) : "";
        const pillW = pillWidth(pillText);
        // Blocked cards the status word doesn't show (e.g. an older card, while the latest replied).
        const alert = showStatus && st && st.tone !== "bad" && st.blockedCards ? `${st.blockedCards} ${t("hermes.st.blocked").toLowerCase()}` : "";
        const alertW = alert ? Math.round(alert.length * 6.2) + 14 : 0;
        const subText = showStatus && st ? truncate(sub(st), Math.max(0, Math.floor((NODE_W - 36 - pillW) / 6))) : "";
        const tasks = tasksByNode.get(box.id) ?? [];
        const dots = mode === "replay" ? tasks.slice(0, 5) : [];

        return (
          <g key={box.id} role="button" tabIndex={0} aria-label={`${name}${st ? `, ${label(st)}` : ""}`} aria-pressed={selected}
            className="cursor-pointer outline-none" opacity={involved(box.id) ? 1 : 0.35}
            onClick={() => onSelect(box.id)}
            onKeyDown={ev => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); onSelect(box.id); } }}>
            {selected && (
              <rect x={box.x - 5} y={box.y - 5} width={NODE_W + 10} height={NODE_H + 10} rx={16} fill="none"
                style={{ stroke: "var(--h-text-2)" }} strokeOpacity={0.55} strokeWidth={1.3} strokeDasharray="4 3" />
            )}
            <rect x={box.x} y={box.y} width={NODE_W} height={NODE_H} rx={12} style={{ fill: "var(--h-surface)", stroke }}
              strokeWidth={strokeWidth} />
            {/* Status strip on the left edge, like a monday.com row colour */}
            {showStatus && st && st.tone !== "idle" && (
              <rect x={box.x + 4} y={box.y + 12} width={4} height={NODE_H - 24} rx={2} style={{ fill: tone.bar }} />
            )}

            <circle cx={box.x + 27} cy={box.y + 29} r={14} style={{ fill: isHuman ? YOU_COLOR : agentColor(snapshot, box.id) }} />
            <text x={box.x + 27} y={box.y + 33} textAnchor="middle" fontSize={isHuman ? 9 : 11} fontWeight={700} fill="#FFFFFF">
              {isHuman ? "YOU" : initials(profile?.isDefault ? profile.name : box.id)}
            </text>
            <text x={box.x + 50} y={box.y + 26} fontSize={13.5} fontWeight={650} style={{ fill: "var(--h-text)" }}>{truncate(name, 18)}</text>
            <text x={box.x + 50} y={box.y + 42} fontSize={11.5} style={{ fill: "var(--h-muted)" }}>{truncate(role, alert ? 11 : 24)}</text>

            {pill && (
              <g>
                <rect x={box.x + 14} y={box.y + 57} width={pillW} height={22} rx={4} style={{ fill: pill.bg }} />
                <text x={box.x + 14 + pillW / 2} y={box.y + 72} textAnchor="middle" fontSize={11.5} fontWeight={600} style={{ fill: pill.fg }}>{pillText}</text>
                {subText && <text x={box.x + 22 + pillW} y={box.y + 72} fontSize={11} style={{ fill: "var(--h-muted)" }}>{subText}</text>}
              </g>
            )}
            {alert && (
              <g>
                <title>{alert}</title>
                <rect x={box.x + NODE_W - 10 - alertW} y={box.y + 31} width={alertW} height={17} rx={4}
                  style={{ fill: TONE_VARS.bad.soft, stroke: TONE_VARS.bad.bar }} strokeWidth={1} />
                <text x={box.x + NODE_W - 10 - alertW / 2} y={box.y + 43} textAnchor="middle" fontSize={10.5} fontWeight={600}
                  style={{ fill: TONE_VARS.bad.bg }}>{alert}</text>
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
