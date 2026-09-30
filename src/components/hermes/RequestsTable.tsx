"use client";

/**
 * RequestsTable — who asked whom, and whether they replied. One row per
 * request (a kanban card or a chat), with a monday.com-style status block:
 * Waiting · Working · Replied · Failed · Review.
 */

import { useState } from "react";
import { ArrowRight, X } from "lucide-react";
import type { HermesSnapshot } from "@/lib/hermes/types";
import { HUMAN_ID, formatDuration } from "@/lib/hermes/metrics";
import { REQUEST_TONE, TONE_VARS, requestRows, requestSummary, shortName, type RequestState, type StatusTone } from "@/lib/hermes/status";
import { YOU_COLOR, agentColor, initials } from "./TeamCanvas";
import { useLanguage } from "@/contexts/LanguageContext";

/** Solid status block with one word — the one status style used across the view. */
export function StatusBlock({ tone, text, className = "", small = false }: { tone: StatusTone; text: string; className?: string; small?: boolean }) {
  const v = TONE_VARS[tone];
  return (
    <span className={`inline-flex shrink-0 items-center justify-center rounded px-2 font-semibold leading-none ${small ? "h-[18px] text-[10.5px]" : "h-[22px] text-[11.5px]"} ${className}`}
      style={{ color: v.fg, background: v.bg }}>
      <span className="truncate">{text}</span>
    </span>
  );
}

const ORDER: RequestState[] = ["failed", "blocked", "working", "waiting", "review", "done"];

export function RequestsTable({ snapshot, onOpenCard, onSelect, nowMs }: {
  snapshot: HermesSnapshot;
  onOpenCard?: (taskId: string) => void;
  onSelect?: (profileId: string) => void;
  /** Current time (ms) from the view's 1 s ticker, for "Updated 12s ago". */
  nowMs?: number;
}) {
  const { t } = useLanguage();
  const [filter, setFilter] = useState<RequestState | null>(null);
  // The summary counts every request in the window; the list shows the newest 20.
  const all = requestRows(snapshot, undefined, Infinity);
  const sum = requestSummary(all);
  const rows = (filter ? all.filter(r => r.state === filter) : all).slice(0, 20);
  const age = nowMs ? Math.max(0, Math.round(nowMs / 1000 - snapshot.generatedAt)) : null;

  const Who = ({ id }: { id: string }) => {
    const p = snapshot.profiles.find(x => x.id === id);
    const name = id === HUMAN_ID || !p ? t("hermes.you") : shortName(p);
    return (
      <button type="button" disabled={!p || !onSelect} onClick={() => p && onSelect?.(p.id)}
        className="inline-flex min-w-0 items-center gap-1.5 rounded text-[12.5px] font-medium text-(--h-text) enabled:hover:underline">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white"
          style={{ background: p ? agentColor(snapshot, p.id) : YOU_COLOR }}>
          {p ? initials(p.isDefault ? p.name : p.id) : "YOU"}
        </span>
        <span className="truncate">{name}</span>
      </button>
    );
  };

  return (
    <section aria-label={t("hermes.req.aria")} className="flex flex-col">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 pb-2 pt-3">
        <h3 className="text-[13px] font-semibold text-(--h-text)">{t("hermes.req.title")}</h3>
        <div className="flex flex-wrap gap-1.5">
          {ORDER.filter(s => sum[s] > 0).map(s => (
            // Each count is a filter: click to show only those requests, again to clear.
            <button key={s} type="button" aria-pressed={filter === s} onClick={() => setFilter(f => (f === s ? null : s))}
              title={filter === s ? t("hermes.req.showAll") : t("hermes.req.onlyThese")}
              className={`rounded transition-opacity ${filter && filter !== s ? "opacity-40 hover:opacity-80" : ""} ${filter === s ? "ring-2 ring-offset-1 ring-(--h-text-2) ring-offset-(--h-surface)" : ""}`}>
              <StatusBlock tone={REQUEST_TONE[s]} text={`${sum[s]} ${t(`hermes.req.${s}` as const)}`} />
            </button>
          ))}
          {filter && (
            <button type="button" onClick={() => setFilter(null)} className="inline-flex items-center gap-0.5 rounded px-1.5 text-[11.5px] text-(--h-muted) hover:text-(--h-text)">
              <X className="h-3 w-3" />{t("hermes.req.showAll")}
            </button>
          )}
        </div>
        {age != null && (
          <span className="ml-auto text-[11.5px] tabular-nums" style={{ color: age > 60 ? "var(--h-st-working-solid)" : "var(--h-faint)" }}>
            {t("hermes.req.updated").replace("{t}", age < 5 ? t("hermes.req.now") : formatDuration(age))}
          </span>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="px-3 pb-3 text-[12.5px] text-(--h-faint)">{t("hermes.req.empty")}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-(--h-border) border-t border-(--h-border)">
          {rows.map(r => {
            const tone = REQUEST_TONE[r.state];
            const ago = t("hermes.req.ago").replace("{t}", formatDuration(Math.max(0, snapshot.generatedAt - r.at)));
            return (
              <li key={r.id} className="flex items-stretch gap-2 pr-3">
                <div className="min-w-0 flex-1 py-2 pl-3">
                  <div className="flex items-center gap-1.5">
                    <Who id={r.from} />
                    <ArrowRight className="h-3.5 w-3.5 shrink-0 text-(--h-faint)" aria-label="to" />
                    <Who id={r.to} />
                  </div>
                  <div className="mt-0.5 flex min-w-0 items-baseline gap-2 text-[12px]">
                    {r.kind === "card" && onOpenCard ? (
                      <button type="button" onClick={() => onOpenCard(r.id)} className="truncate text-left text-(--h-text-2) hover:underline">{r.title}</button>
                    ) : <span className="truncate text-(--h-text-2)">{r.title}</span>}
                    <span className="shrink-0 text-[11px] text-(--h-faint)">{ago}</span>
                  </div>
                  {r.note && (
                    <div className="mt-0.5 truncate text-[11.5px]" style={{ color: r.state === "failed" || r.state === "blocked" ? "var(--h-st-stuck)" : "var(--h-muted)" }} title={r.note}>{r.note}</div>
                  )}
                </div>
                <div className="flex items-center">
                  <StatusBlock tone={tone} text={t(`hermes.req.${r.state}` as const)} className="w-[76px]" />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
