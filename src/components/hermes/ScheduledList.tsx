"use client";

/**
 * ScheduledList — Hermes scheduled jobs (`hermes cron`), soonest first, grouped
 * Today / Tomorrow / Later, with a status block, "in 28m" and the last runs as
 * dots. Read-only: creating, pausing and editing jobs stays in Hermes.
 */

import type { HermesJob, HermesSnapshot } from "@/lib/hermes/types";
import { formatDuration } from "@/lib/hermes/metrics";
import { jobTone, shortName, TONE_VARS } from "@/lib/hermes/status";
import { agentColor, initials } from "./TeamCanvas";
import { StatusBlock } from "./RequestsTable";
import { useLanguage } from "@/contexts/LanguageContext";
import type { TranslationKey } from "@/lib/i18n";

type Group = "today" | "tomorrow" | "later" | "inactive";

function groupOf(job: HermesJob, nowS: number): Group {
  if (job.state === "running") return "today";
  if (!job.nextRunAt || job.state === "paused" || job.state === "completed") return "inactive";
  const day = (unix: number) => new Date(unix * 1000).toDateString();
  if (day(job.nextRunAt) === day(nowS)) return "today";
  if (day(job.nextRunAt) === day(nowS + 86400)) return "tomorrow";
  return "later";
}

const clockTime = (unix: number) => new Date(unix * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** The last runs as small dots, newest on the right. */
export function RunDots({ runs }: { runs: HermesJob["runs"] }) {
  if (!runs.length) return null;
  return (
    <span className="inline-flex items-center gap-[3px]" aria-hidden="true">
      {[...runs].reverse().map((r, i) => (
        <i key={i} className="inline-block h-1.5 w-1.5 rounded-full" title={new Date(r.at * 1000).toLocaleString()}
          style={{ background: r.status === "completed" ? TONE_VARS.ok.bar : r.status === "failed" ? TONE_VARS.bad.bar : r.status === "running" ? TONE_VARS.working.bar : TONE_VARS.idle.bar }} />
      ))}
    </span>
  );
}

/** "in 28m" / "due now" / "at 09:00" / "Running · 1m" — the one time that matters. */
export function useJobWhen() {
  const { t } = useLanguage();
  return (job: HermesJob, nowS: number) => {
    if (job.state === "running") return job.runs[0] ? formatDuration(Math.max(0, nowS - job.runs[0].at)) : "";
    if (!job.nextRunAt) return job.lastRunAt ? t("hermes.sched.lastRun").replace("{t}", formatDuration(Math.max(0, nowS - job.lastRunAt))) : t("hermes.sched.never");
    const wait = job.nextRunAt - nowS;
    if (wait <= 30) return t("hermes.sched.due");
    return wait < 6 * 3600 ? t("hermes.sched.in").replace("{t}", formatDuration(wait)) : t("hermes.sched.at").replace("{t}", clockTime(job.nextRunAt));
  };
}

export function ScheduledList({ snapshot, nowMs, onSelect }: { snapshot: HermesSnapshot; nowMs: number; onSelect?: (profileId: string) => void }) {
  const { t } = useLanguage();
  const when = useJobWhen();
  const jobs = snapshot.jobs ?? [];
  const nowS = nowMs / 1000;
  const groups: Group[] = ["today", "tomorrow", "later", "inactive"];
  const byGroup = new Map<Group, HermesJob[]>();
  for (const j of jobs) byGroup.set(groupOf(j, nowS), [...(byGroup.get(groupOf(j, nowS)) ?? []), j]);

  return (
    <section aria-label={t("hermes.sched.aria")} className="flex flex-col">
      <div className="flex items-center gap-2 px-3 pb-2 pt-3">
        <h3 className="text-[13px] font-semibold text-(--h-text)">{t("hermes.sched.title")}</h3>
        {jobs.length > 0 && <span className="text-[12px] text-(--h-faint)">{jobs.length}</span>}
      </div>
      {jobs.length === 0 ? (
        <p className="px-3 pb-3 text-[12.5px] text-(--h-faint)">{t("hermes.sched.empty")}</p>
      ) : groups.filter(g => byGroup.get(g)?.length).map(g => (
        <div key={g}>
          <div className="border-t border-(--h-border) bg-(--h-sunk) px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-(--h-muted)">
            {t(`hermes.sched.${g}` as TranslationKey)}
          </div>
          <ul className="flex flex-col divide-y divide-(--h-border)">
            {byGroup.get(g)!.map(job => {
              const p = snapshot.profiles.find(x => x.id === job.profileId);
              const jt = jobTone(job);
              const note = job.state === "error" ? job.lastError : job.state === "paused" ? job.pausedReason : job.lastReply ? `“${job.lastReply}”` : null;
              return (
                <li key={`${job.profileId}:${job.id}`} className="flex items-center gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-1.5 text-[12.5px]">
                      <button type="button" disabled={!p || !onSelect} onClick={() => p && onSelect?.(p.id)}
                        className="inline-flex shrink-0 items-center gap-1.5 font-medium text-(--h-text) enabled:hover:underline">
                        <span className="flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold text-white"
                          style={{ background: p ? agentColor(snapshot, p.id) : "var(--h-text-2)" }}>{p ? initials(p.isDefault ? p.name : p.id) : "?"}</span>
                        {p ? shortName(p) : job.profileId}
                      </button>
                      <span className="text-(--h-faint)">·</span>
                      <span className="truncate font-medium text-(--h-text-2)">{job.name}</span>
                    </div>
                    <div className="mt-0.5 flex min-w-0 items-center gap-2 text-[12px] text-(--h-muted)">
                      <span className="shrink-0">{job.scheduleText}</span>
                      <RunDots runs={job.runs} />
                      {note && <span className="truncate" style={job.state === "error" ? { color: TONE_VARS.bad.bg } : undefined} title={note}>{note}</span>}
                    </div>
                  </div>
                  <span className="shrink-0 text-[12px] tabular-nums text-(--h-muted)">{when(job, nowS)}</span>
                  <StatusBlock tone={jt.tone} text={t(jt.key as TranslationKey)} className="w-[76px]" />
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}
