"use client";

/**
 * TeamRoster — the team as a stacked list, for narrow panes (the Hermes
 * desktop window) where the map would shrink to unreadable text.
 * Orchestrator first, then workers; one status pill per agent.
 */

import type { HermesSnapshot } from "@/lib/hermes/types";
import { agentStatus, roleOf, shortName, TONE_VARS } from "@/lib/hermes/status";
import { agentColor, initials, useStatusLabel } from "./TeamCanvas";
import { useLanguage } from "@/contexts/LanguageContext";

interface Props {
  snapshot: HermesSnapshot;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function TeamRoster({ snapshot, selectedId, onSelect }: Props) {
  const { t } = useLanguage();
  const label = useStatusLabel();
  const ordered = [...snapshot.profiles].sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
  const workingCount = ordered.filter(p => agentStatus(snapshot, p.id).working).length;

  return (
    <div className="flex flex-col gap-2 p-3">
      <div className="flex items-baseline justify-between px-1 text-[11px] font-medium uppercase tracking-wider text-(--h-muted)">
        <span>{t("hermes.roster.team")} · {ordered.length}</span>
        {workingCount > 0 && <span className="normal-case tracking-normal text-(--h-accent)">{t("hermes.roster.working").replace("{n}", String(workingCount))}</span>}
      </div>
      <ul className="flex flex-col gap-1.5">
        {ordered.map(p => {
          const st = agentStatus(snapshot, p.id);
          const tone = TONE_VARS[st.tone];
          const selected = selectedId === p.id;
          return (
            <li key={p.id}>
              <button type="button" onClick={() => onSelect(p.id)} aria-pressed={selected}
                className={`flex w-full items-start gap-3 rounded-xl border bg-(--h-surface) px-3 py-2.5 text-left transition-colors hover:bg-(--h-sunk) focus-visible:outline-2 focus-visible:outline-(--h-accent) ${p.isDefault ? "" : "ml-0"}`}
                style={{
                  borderColor: st.working ? "var(--h-accent)" : st.tone === "bad" ? "var(--h-bad)" : "var(--h-border)",
                  borderWidth: st.working ? 2 : 1,
                  outline: selected ? "1.5px dashed var(--h-text-2)" : undefined,
                  outlineOffset: selected ? 3 : undefined,
                }}>
                <span className="relative mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                  style={{ background: agentColor(snapshot, p.id) }}>
                  {initials(p.isDefault ? p.name : p.id)}
                  {st.working && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 animate-pulse rounded-full border-2 border-(--h-surface) bg-(--h-accent)" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-[13.5px] font-semibold text-(--h-text)">{shortName(p)}</span>
                    <span className="text-[12px] text-(--h-muted)">{roleOf(p)}</span>
                  </span>
                  <span className="mt-1 inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-semibold"
                    style={{ color: tone.fg, background: tone.bg }}>
                    <span aria-hidden="true">{st.icon}</span>
                    <span className="truncate">{label(st)}</span>
                  </span>
                  {st.detail && <span className="mt-1 block truncate text-[12px] text-(--h-muted)">{st.detail}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
