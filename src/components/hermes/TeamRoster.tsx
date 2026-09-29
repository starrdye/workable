"use client";

/**
 * TeamRoster — the team as a stacked list, for narrow panes (the Hermes
 * desktop window) where the map would shrink to unreadable text.
 * Orchestrator first, then workers; one solid status block per agent and
 * no looping animation.
 */

import type { HermesSnapshot } from "@/lib/hermes/types";
import { agentStatus, roleOf, shortName, TONE_VARS } from "@/lib/hermes/status";
import { agentColor, initials, useStatusLabel, useStatusSub } from "./TeamCanvas";
import { StatusBlock } from "./RequestsTable";
import { useLanguage } from "@/contexts/LanguageContext";

interface Props {
  snapshot: HermesSnapshot;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function TeamRoster({ snapshot, selectedId, onSelect }: Props) {
  const { t } = useLanguage();
  const label = useStatusLabel();
  const sub = useStatusSub();
  const ordered = [...snapshot.profiles].sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
  const workingCount = ordered.filter(p => agentStatus(snapshot, p.id).working).length;

  return (
    <div className="flex flex-col gap-2 p-3">
      <div className="flex items-baseline justify-between px-1 text-[11px] font-medium uppercase tracking-wider text-(--h-muted)">
        <span>{t("hermes.roster.team")} · {ordered.length}</span>
        {workingCount > 0 && <span className="normal-case tracking-normal text-(--h-st-working)">{t("hermes.roster.working").replace("{n}", String(workingCount))}</span>}
      </div>
      <ul className="flex flex-col gap-1.5">
        {ordered.map(p => {
          const st = agentStatus(snapshot, p.id);
          const tone = TONE_VARS[st.tone];
          const selected = selectedId === p.id;
          const strong = st.working; // only "working right now" gets a coloured border
          return (
            <li key={p.id}>
              <button type="button" onClick={() => onSelect(p.id)} aria-pressed={selected}
                className="flex w-full items-stretch overflow-hidden rounded-lg border bg-(--h-surface) text-left transition-colors hover:bg-(--h-sunk) focus-visible:outline-2 focus-visible:outline-(--h-accent)"
                style={{
                  borderColor: strong ? tone.bg : "var(--h-border)",
                  outline: selected ? "1.5px dashed var(--h-text-2)" : undefined,
                  outlineOffset: selected ? 2 : undefined,
                }}>
                {/* Row colour bar */}
                <span className="w-1 shrink-0" style={{ background: st.tone === "idle" ? "transparent" : tone.bg }} aria-hidden="true" />
                <span className="flex min-w-0 flex-1 items-start gap-3 px-3 py-2.5">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                    style={{ background: agentColor(snapshot, p.id) }}>
                    {initials(p.isDefault ? p.name : p.id)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate">
                        <span className="text-[13.5px] font-semibold text-(--h-text)">{shortName(p)}</span>
                        <span className="ml-2 text-[12px] text-(--h-muted)">{roleOf(p)}</span>
                      </span>
                      <StatusBlock tone={st.tone} text={label(st)} className="min-w-[72px]" />
                    </span>
                    {(st.detail || sub(st)) && (
                      <span className="mt-1 flex min-w-0 gap-2 text-[12px]">
                        {st.detail && <span className="truncate text-(--h-text-2)">{st.detail}</span>}
                        {sub(st) && <span className="shrink-0 text-(--h-faint)">{sub(st)}</span>}
                      </span>
                    )}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
