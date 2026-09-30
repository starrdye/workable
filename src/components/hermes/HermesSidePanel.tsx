"use client";

/**
 * HermesSidePanel — the selected agent, chat-first: who it is and its status,
 * what it's doing now, recent chats, then board work and details. Kanban
 * numbers only appear when there is kanban activity to show.
 */

import { AlertTriangle, History, Pencil } from "lucide-react";
import type { ChatSession, HermesProfile, HermesSnapshot, TurnOutcome } from "@/lib/hermes/types";
import { HUMAN_ID, formatDuration } from "@/lib/hermes/metrics";
import { agentStatus, cardState, humanError, jobTone, REQUEST_TONE, roleOf, shortName, TONE_VARS, type StatusTone } from "@/lib/hermes/status";
import { RunDots, useJobWhen } from "./ScheduledList";
import type { TranslationKey } from "@/lib/i18n";
import { agentColor, initials, useStatusLabel, useStatusSub } from "./TeamCanvas";
import { StatusBlock } from "./RequestsTable";
import { useLanguage } from "@/contexts/LanguageContext";

interface Props {
  snapshot: HermesSnapshot;
  selectedId: string | null;
  onOpenReplay: (taskId: string) => void;
  /** Present when editing is on. */
  onEdit?: (profile: HermesProfile) => void;
  /** Current time (ms), for "in 28m" on scheduled jobs. */
  nowMs?: number;
}

const OUTCOME_TONE: Record<TurnOutcome, StatusTone> = {
  working: "working", completed: "ok", failed: "bad", "cut-off": "bad", interrupted: "bad", none: "idle",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[11px] font-medium uppercase tracking-wider text-(--h-muted)">{title}</h3>
      {children}
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: StatusTone }) {
  return (
    <div className="rounded-lg bg-(--h-sunk) px-2.5 py-2">
      <div className="text-[10.5px] uppercase tracking-wide text-(--h-muted)">{label}</div>
      <div className="font-mono text-sm tabular-nums" style={{ color: tone ? TONE_VARS[tone].bg : "var(--h-text)" }}>{value}</div>
    </div>
  );
}

export function HermesSidePanel({ snapshot, selectedId, onOpenReplay, onEdit, nowMs }: Props) {
  const { t } = useLanguage();
  const label = useStatusLabel();
  const sub = useStatusSub();
  const when = useJobWhen();
  const id = selectedId ?? snapshot.profiles.find(p => agentStatus(snapshot, p.id).working)?.id
    ?? snapshot.bottleneck?.profileId ?? snapshot.profiles.find(p => p.isDefault)?.id ?? null;
  const bottleneck = snapshot.bottleneck;

  if (id === HUMAN_ID) {
    const mine = snapshot.tasks.filter(task => task.createdBy && !snapshot.profiles.some(p => p.id === task.createdBy));
    return (
      <div className="flex flex-col gap-3">
        <h2 className="text-[15px] font-semibold text-(--h-text)">{t("hermes.you")}</h2>
        <p className="text-[12.5px] leading-relaxed text-(--h-muted)">{t("hermes.side.youDesc")}</p>
        <Stat label={t("hermes.side.cardsYouCreated")} value={String(mine.length)} />
        <p className="text-xs leading-relaxed text-(--h-muted)">{t("hermes.side.youNote")}</p>
      </div>
    );
  }

  const profile = snapshot.profiles.find(p => p.id === id);
  if (!profile) return <p className="text-sm text-(--h-muted)">{t("hermes.side.pick")}</p>;
  const st = agentStatus(snapshot, profile.id);
  const m = snapshot.metrics.find(x => x.profileId === profile.id);
  const cards = snapshot.tasks.filter(task => task.assignee === profile.id);
  const act = snapshot.activity?.find(a => a.profileId === profile.id);
  const hasBoardActivity = !!m && (m.queued + m.running + m.blocked + m.reviewQueue + m.runs > 0);
  const current: ChatSession | null = act?.current ?? null;
  // A worker running a card is a session too; the Cards section covers those.
  const chats = (act?.recent ?? []).filter(c => c.source !== "kanban" && c.source !== "cron");
  const jobs = (snapshot.jobs ?? []).filter(j => j.profileId === profile.id);

  return (
    <div className="flex flex-col gap-5">
      {/* Who */}
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[12px] font-bold text-white"
          style={{ background: agentColor(snapshot, profile.id) }}>
          {initials(profile.isDefault ? profile.name : profile.id)}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold text-(--h-text)">{shortName(profile)}</h2>
          <p className="text-[12.5px] text-(--h-muted)">{roleOf(profile)}</p>
          <div className="mt-1.5 flex items-center gap-2"><StatusBlock tone={st.tone} text={label(st)} className="min-w-[72px]" />{sub(st) && <span className="truncate text-[12px] text-(--h-faint)">{sub(st)}</span>}</div>
        </div>
        {onEdit && (
          <button type="button" onClick={() => onEdit(profile)} aria-label={t("hermes.edit.editButton")} title={t("hermes.edit.editButton")}
            className="rounded-md p-1.5 text-(--h-muted) hover:bg-(--h-sunk) hover:text-(--h-text)">
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {profile.description && <p className="-mt-2 text-[12.5px] leading-relaxed text-(--h-muted)">{profile.description}</p>}

      {/* Now */}
      {current && (
        <div className="rounded-lg border-l-4 border-(--h-st-working) bg-(--h-st-working-soft) px-3 py-2.5">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-(--h-text-2)">{t("hermes.side.workingOn")}</div>
          <div className="mt-0.5 text-[13px] text-(--h-text)">{current.title}</div>
          <div className="mt-1 font-mono text-[11px] text-(--h-muted)">{current.source}{current.step ? ` · ${current.step}` : ""}</div>
        </div>
      )}

      {bottleneck?.profileId === profile.id && (
        <div className="rounded-xl bg-(--h-warn-soft) p-3 text-[12.5px] leading-relaxed text-(--h-text-2)">
          <div className="mb-1 flex items-center gap-1.5 font-semibold text-(--h-warn)"><AlertTriangle className="h-3.5 w-3.5" />{t("hermes.side.bottleneck")}</div>
          <p>{bottleneck.reason}</p>
          <p className="mt-1.5 text-(--h-muted)">{bottleneck.suggestion}</p>
        </div>
      )}

      {/* Chats */}
      {chats.length > 0 && (
        <Section title={`${t("hermes.side.chats")} · ${chats.length}`}>
          <ul className="flex flex-col gap-1.5">
            {chats.map(c => (
              <li key={c.id} className="rounded-lg bg-(--h-sunk) px-2.5 py-2 text-[12.5px]">
                <div className="flex items-start gap-2">
                  <span className="min-w-0 flex-1 text-(--h-text-2)">{c.title}</span>
                  {c.outcome !== "none" && <StatusBlock small tone={OUTCOME_TONE[c.outcome]} text={t(`hermes.outcome.${c.outcome}` as const)} />}
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-(--h-faint)">
                  <span>{c.source}</span>
                  <span>{c.working ? (c.step ?? "") : `${formatDuration(snapshot.generatedAt - c.lastAt)} ${t("hermes.side.ago")}`}</span>
                  <span>{c.messages} {t("hermes.side.msgs")}</span>
                </div>
                {c.error && <div className="mt-1 break-words text-[11.5px] text-(--h-st-stuck)">{humanError(c.error)}</div>}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Scheduled jobs */}
      {jobs.length > 0 && (
        <Section title={`${t("hermes.sched.title")} · ${jobs.length}`}>
          <ul className="flex flex-col gap-1.5">
            {jobs.map(job => {
              const jt = jobTone(job);
              return (
                <li key={job.id} className="rounded-lg bg-(--h-sunk) px-2.5 py-2 text-[12.5px]">
                  <div className="flex items-start gap-2">
                    <span className="min-w-0 flex-1 font-medium text-(--h-text-2)">{job.name}</span>
                    <StatusBlock small tone={jt.tone} text={t(jt.key as TranslationKey)} />
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-(--h-faint)">
                    <span>{job.scheduleText}</span>
                    <span>{when(job, nowMs ? nowMs / 1000 : snapshot.generatedAt)}</span>
                    <RunDots runs={job.runs} />
                  </div>
                  {job.state === "error" && job.lastError && <div className="mt-1 break-words text-[11.5px]" style={{ color: TONE_VARS.bad.bg }}>{job.lastError}</div>}
                  {job.state !== "error" && job.lastReply && <div className="mt-1 truncate text-[11.5px] text-(--h-muted)" title={job.lastReply}>“{job.lastReply}”</div>}
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      {/* Board work */}
      {cards.length > 0 && (
        <Section title={`${t("hermes.side.cards")} · ${cards.length}`}>
          <ul className="flex flex-col gap-1.5">
            {cards.slice(0, 12).map(card => (
              <li key={card.id}>
                <button type="button" onClick={() => onOpenReplay(card.id)} title={t("hermes.side.openReplay")}
                  className="group flex w-full items-start gap-2 rounded-lg bg-(--h-sunk) px-2.5 py-1.5 text-left text-[12.5px] hover:bg-(--h-accent-soft) focus-visible:outline-2 focus-visible:outline-(--h-accent)">
                  <span className="min-w-0 flex-1 text-(--h-text-2)">{card.title}</span>
                  <History className="mt-0.5 h-3.5 w-3.5 shrink-0 text-(--h-faint) opacity-0 group-hover:opacity-100" aria-hidden="true" />
                  <StatusBlock small tone={REQUEST_TONE[cardState(card)]} text={t(`hermes.req.${cardState(card)}` as const)} />
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {hasBoardActivity && m ? (
        <Section title={t("hermes.side.last7")}>
          {/* One line; zero counts are left out, problems are coloured. */}
          <p className="flex flex-wrap gap-x-1.5 gap-y-0.5 text-[12.5px] tabular-nums text-(--h-text-2)">
            {([
              m.runs ? { text: t("hermes.side.runs").replace("{n}", String(m.runs)) } : null,
              m.successRate != null ? { text: t("hermes.side.success").replace("{p}", String(Math.round(m.successRate * 100))), tone: m.successRate < 0.7 ? "bad" as const : undefined } : null,
              m.medianRunSeconds != null ? { text: t("hermes.side.median").replace("{t}", formatDuration(m.medianRunSeconds)) } : null,
              m.running ? { text: t("hermes.side.runningN").replace("{n}", String(m.running)), tone: "working" as const } : null,
              m.queued ? { text: t("hermes.side.queuedN").replace("{n}", String(m.queued)) } : null,
              m.blocked ? { text: t("hermes.side.blockedN").replace("{n}", String(m.blocked)), tone: "bad" as const } : null,
              m.reviewQueue ? { text: t("hermes.side.reviewN").replace("{n}", String(m.reviewQueue)), tone: m.reviewQueue > 2 ? "warn" as const : undefined } : null,
            ] as Array<{ text: string; tone?: StatusTone } | null>).filter((x): x is { text: string; tone?: StatusTone } => !!x).map((x, i) => (
              <span key={x.text}>
                {i > 0 && <span className="mr-1.5 text-(--h-faint)">·</span>}
                <span style={x.tone ? { color: TONE_VARS[x.tone].bg, fontWeight: 600 } : undefined}>{x.text}</span>
              </span>
            ))}
          </p>
          {m.lastError && <p className="rounded-lg bg-(--h-st-stuck-soft) px-2.5 py-2 text-[12px] leading-snug text-(--h-st-stuck-solid) break-words">{humanError(m.lastError)}</p>}
        </Section>
      ) : (
        <p className="text-[12px] text-(--h-faint)">{t("hermes.side.noBoard")}</p>
      )}

      {/* Details */}
      <Section title={t("hermes.side.details")}>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12.5px]">
          <dt className="text-(--h-muted)">{t("hermes.side.model")}</dt><dd className="break-all font-mono text-[11.5px] text-(--h-text-2)">{profile.model ?? "—"}</dd>
          <dt className="text-(--h-muted)">{t("hermes.side.profile")}</dt><dd className="font-mono text-[11.5px] text-(--h-text-2)">{profile.id}</dd>
          <dt className="text-(--h-muted)">{t("hermes.side.desktop")}</dt><dd className="font-mono text-[11.5px] text-(--h-text-2)">{profile.unattended ? t("hermes.side.desktopOff") : t("hermes.side.desktopOn")}</dd>
        </dl>
      </Section>
    </div>
  );
}
