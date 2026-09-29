"use client";

/**
 * HermesSidePanel — details for the selected node: profile facts, run
 * metrics from the board, its cards, and the bottleneck call-out.
 */

import { AlertTriangle, CheckCircle2, History, Pencil } from "lucide-react";
import type { HermesProfile, HermesSnapshot } from "@/lib/hermes/types";
import { HUMAN_ID, formatDuration } from "@/lib/hermes/metrics";
import { DOT_COLORS } from "./TeamCanvas";
import { useLanguage } from "@/contexts/LanguageContext";

interface Props {
  snapshot: HermesSnapshot;
  selectedId: string | null;
  onOpenReplay: (taskId: string) => void;
  /** Present when editing is on. */
  onEdit?: (profile: HermesProfile) => void;
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "bad" | "warn" }) {
  const color = tone === "bad" ? "text-red-600" : tone === "warn" ? "text-amber-600" : "text-slate-800";
  return (
    <div className="rounded-lg bg-slate-50 px-2.5 py-2">
      <div className="text-[10.5px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`font-mono text-sm tabular-nums ${color}`}>{value}</div>
    </div>
  );
}

export function HermesSidePanel({ snapshot, selectedId, onOpenReplay, onEdit }: Props) {
  const { t } = useLanguage();
  const id = selectedId ?? snapshot.bottleneck?.profileId ?? snapshot.profiles.find(p => p.isDefault)?.id ?? null;
  const bottleneck = snapshot.bottleneck;

  if (id === HUMAN_ID) {
    const mine = snapshot.tasks.filter(task => task.createdBy && !snapshot.profiles.some(p => p.id === task.createdBy));
    return (
      <div className="flex flex-col gap-3">
        <Header eyebrow={t("hermes.side.selected")} title={t("hermes.you")} sub={t("hermes.side.youDesc")} />
        <Stat label={t("hermes.side.cardsYouCreated")} value={String(mine.length)} />
        <p className="text-xs text-slate-500 leading-relaxed">{t("hermes.side.youNote")}</p>
      </div>
    );
  }

  const profile = snapshot.profiles.find(p => p.id === id);
  if (!profile) return <p className="text-sm text-slate-500">{t("hermes.side.pick")}</p>;
  const m = snapshot.metrics.find(x => x.profileId === profile.id);
  const cards = snapshot.tasks.filter(task => task.assignee === profile.id);
  const isBottleneck = bottleneck?.profileId === profile.id;
  const act = snapshot.activity?.find(a => a.profileId === profile.id);

  return (
    <div className="flex flex-col gap-4">
      <Header eyebrow={profile.isDefault ? t("hermes.orchestrator") : t("hermes.side.worker")} title={profile.name} sub={profile.description} />
      {onEdit && (
        <button type="button" onClick={() => onEdit(profile)}
          className="inline-flex w-fit items-center gap-1.5 rounded-md border border-gray-300 px-2.5 py-1 text-[12.5px] text-slate-700 hover:bg-gray-50">
          <Pencil className="h-3.5 w-3.5" />{t("hermes.edit.editButton")}
        </button>
      )}

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
        <dt className="text-slate-500">{t("hermes.side.model")}</dt><dd className="font-mono text-xs text-slate-700 break-all">{profile.model ?? "—"}</dd>
        <dt className="text-slate-500">{t("hermes.side.profile")}</dt><dd className="font-mono text-xs text-slate-700">{profile.id}</dd>
        <dt className="text-slate-500">{t("hermes.side.desktop")}</dt><dd className="font-mono text-xs text-slate-700">{profile.unattended ? t("hermes.side.desktopOff") : t("hermes.side.desktopOn")}</dd>
      </dl>

      {isBottleneck && bottleneck && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-[12.5px] leading-relaxed text-slate-700">
          <div className="mb-1 flex items-center gap-1.5 font-semibold text-amber-700"><AlertTriangle className="h-3.5 w-3.5" />{t("hermes.side.bottleneck")}</div>
          <p>{bottleneck.reason}</p>
          <p className="mt-1.5 text-slate-600">{bottleneck.suggestion}</p>
        </div>
      )}

      {m && (
        <section className="flex flex-col gap-2">
          <div className="text-[11px] font-medium uppercase tracking-wider text-slate-500">{t("hermes.side.now")}</div>
          <div className="grid grid-cols-2 gap-2">
            <Stat label={t("hermes.side.queued")} value={String(m.queued)} />
            <Stat label={t("hermes.side.running")} value={String(m.running)} />
            <Stat label={t("hermes.side.blocked")} value={String(m.blocked)} tone={m.blocked ? "bad" : undefined} />
            <Stat label={t("hermes.side.reviewQueue")} value={String(m.reviewQueue)} tone={m.reviewQueue > 2 ? "warn" : undefined} />
          </div>
          <div className="mt-1 text-[11px] font-medium uppercase tracking-wider text-slate-500">{t("hermes.side.last7")}</div>
          <div className="grid grid-cols-2 gap-2">
            <Stat label={t("hermes.side.successRate")} value={m.successRate == null ? "—" : `${Math.round(m.successRate * 100)}% · ${m.runs}`}
              tone={m.successRate != null && m.successRate < 0.7 ? "bad" : undefined} />
            <Stat label={t("hermes.side.medianRun")} value={formatDuration(m.medianRunSeconds)} />
            <Stat label={t("hermes.side.oldestReview")} value={formatDuration(m.oldestReviewWait)} tone={(m.oldestReviewWait ?? 0) > 7200 ? "warn" : undefined} />
            <Stat label={t("hermes.side.medianReview")} value={formatDuration(m.medianReviewWait)} />
          </div>
          {m.lastError && (
            <p className="rounded-lg bg-red-50 px-2.5 py-2 font-mono text-[11.5px] leading-snug text-red-700 break-words">{m.lastError.split("\n")[0]}</p>
          )}
        </section>
      )}

      {act && act.recent.length > 0 && (
        <section className="flex flex-col gap-2">
          <div className="text-[11px] font-medium uppercase tracking-wider text-slate-500">{t("hermes.side.chats")} · {act.chats24h}</div>
          <ul className="flex flex-col gap-1.5">
            {act.recent.map(c => (
              <li key={c.id} className={`rounded-lg px-2 py-1.5 text-[12.5px] ${c.working ? "bg-indigo-50 ring-1 ring-indigo-200" : "bg-slate-50"}`}>
                <div className="text-slate-700">{c.title}</div>
                <div className="flex gap-2 font-mono text-[10.5px] text-slate-400">
                  <span>{c.source}</span>
                  <span>{c.working ? `${t("hermes.status.replying")}${c.step ? ` · ${c.step}` : ""}` : `${formatDuration(snapshot.generatedAt - c.lastAt)} ${t("hermes.side.ago")}`}</span>
                  <span>{c.messages} {t("hermes.side.msgs")}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <div className="text-[11px] font-medium uppercase tracking-wider text-slate-500">{t("hermes.side.cards")} · {cards.length}</div>
        {cards.length === 0 && (
          <p className="flex items-center gap-1.5 text-[12.5px] text-slate-500"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />{t("hermes.side.noCards")}</p>
        )}
        <ul className="flex flex-col gap-1.5">
          {cards.slice(0, 12).map(card => (
            <li key={card.id}>
              <button type="button" onClick={() => onOpenReplay(card.id)} title={t("hermes.side.openReplay")}
                className="group grid w-full grid-cols-[10px_1fr_auto] items-start gap-2 rounded-lg bg-slate-50 px-2 py-1.5 text-left text-[12.5px] hover:bg-indigo-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500">
                <span className="mt-1.5 h-2 w-2 rounded-full" style={{ background: DOT_COLORS[card.dot] }} />
                <span className="text-slate-700">{card.title}</span>
                <span className="flex items-center gap-1 font-mono text-[10.5px] uppercase text-slate-400 group-hover:text-indigo-600">
                  {card.status}<History className="h-3 w-3 opacity-0 group-hover:opacity-100" />
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Header({ eyebrow, title, sub }: { eyebrow: string; title: string; sub: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="text-[11px] font-medium uppercase tracking-wider text-slate-500">{eyebrow}</div>
      <h2 className="font-mono text-sm font-semibold text-slate-800 break-all">{title}</h2>
      {sub && <p className="text-[12.5px] leading-relaxed text-slate-500">{sub}</p>}
    </div>
  );
}
