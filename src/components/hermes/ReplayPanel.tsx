"use client";

/**
 * ReplayPanel — step through one card's history. Each step highlights the
 * hand-off (or node) on the canvas; the time bar shows where the card waited.
 */

import { useEffect, useMemo, useState } from "react";
import { Pause, Play, SkipBack, SkipForward } from "lucide-react";
import type { HermesSnapshot, HermesTaskDetail } from "@/lib/hermes/types";
import { HUMAN_ID, formatDuration, timeByHolder } from "@/lib/hermes/metrics";
import type { ReplayFocus } from "./TeamCanvas";
import { useLanguage } from "@/contexts/LanguageContext";

interface Props {
  snapshot: HermesSnapshot;
  taskId: string | null;
  onTaskChange: (taskId: string) => void;
  onFocus: (focus: ReplayFocus | null) => void;
}

const HOLDER_COLORS = ["#4F46E5", "#0EA5E9", "#10B981", "#A855F7", "#EC4899", "#F59E0B"];

export function ReplayPanel({ snapshot, taskId, onTaskChange, onFocus }: Props) {
  const { t } = useLanguage();
  const [detail, setDetail] = useState<HermesTaskDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);

  const cardOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const task of snapshot.tasks) seen.set(task.id, task.title);
    for (const e of snapshot.events) if (!seen.has(e.taskId)) seen.set(e.taskId, e.taskTitle);
    return [...seen.entries()];
  }, [snapshot.tasks, snapshot.events]);

  // Load the card's history (sample mode builds it from the snapshot's own events).
  useEffect(() => {
    let cancelled = false;
    setStep(0);
    setPlaying(false);
    setError(null);
    if (!taskId) { setDetail(null); return; }
    const task = snapshot.tasks.find(x => x.id === taskId);
    if (snapshot.sample) {
      if (task) setDetail({ task, events: snapshot.events.filter(e => e.taskId === taskId).sort((a, b) => a.id - b.id), runs: [] });
      return;
    }
    const qs = snapshot.board ? `?board=${encodeURIComponent(snapshot.board.slug)}` : "";
    fetch(`/api/hermes/task/${encodeURIComponent(taskId)}${qs}`, { cache: "no-store" })
      .then(async res => {
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
        if (!cancelled) setDetail(body as HermesTaskDetail);
      })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)); });
    return () => { cancelled = true; };
    // Re-fetch only when the card or board changes, not on every poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, snapshot.sample, snapshot.board?.slug]);

  const events = useMemo(() => detail?.events ?? [], [detail]);
  const current = events[Math.min(step, events.length - 1)];

  useEffect(() => {
    onFocus(current ? { from: current.from, to: current.to, at: current.at } : null);
  }, [current, onFocus]);

  useEffect(() => {
    if (!playing) return;
    if (step >= events.length - 1) { setPlaying(false); return; }
    const id = window.setTimeout(() => setStep(s => s + 1), 1200);
    return () => window.clearTimeout(id);
  }, [playing, step, events.length]);

  const nameOf = (id: string | null) => {
    if (!id) return "—";
    if (id === HUMAN_ID || !snapshot.profiles.some(p => p.id === id)) return t("hermes.you");
    return id.replace(/^personal-/, "");
  };
  const breakdown = useMemo(() => timeByHolder(events), [events]);
  const total = breakdown.reduce((s, b) => s + b.seconds, 0);
  const start = events[0]?.createdAt ?? 0;

  return (
    <div className="flex flex-col gap-3 border-t border-gray-200 bg-white px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="hermes-replay-card" className="text-[11px] font-medium uppercase tracking-wider text-slate-500">{t("hermes.replay.card")}</label>
        <select id="hermes-replay-card" value={taskId ?? ""} onChange={e => onTaskChange(e.target.value)}
          className="min-w-0 max-w-full flex-1 rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-slate-700 sm:flex-none sm:max-w-md">
          <option value="" disabled>{cardOptions.length ? t("hermes.replay.pick") : t("hermes.replay.none")}</option>
          {cardOptions.map(([id, title]) => <option key={id} value={id}>{`${id} · ${title}`}</option>)}
        </select>
        {events.length > 0 && (
          <div className="flex items-center gap-1">
            <button type="button" aria-label={t("hermes.replay.prev")} onClick={() => setStep(s => Math.max(0, s - 1))}
              className="rounded-md border border-gray-300 p-1.5 text-slate-600 hover:bg-gray-50"><SkipBack className="h-3.5 w-3.5" /></button>
            <button type="button" aria-label={playing ? t("hermes.replay.pause") : t("hermes.replay.play")}
              onClick={() => { if (step >= events.length - 1) setStep(0); setPlaying(p => !p); }}
              className="rounded-md border border-indigo-300 bg-indigo-50 p-1.5 text-indigo-700 hover:bg-indigo-100">
              {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            </button>
            <button type="button" aria-label={t("hermes.replay.next")} onClick={() => setStep(s => Math.min(events.length - 1, s + 1))}
              className="rounded-md border border-gray-300 p-1.5 text-slate-600 hover:bg-gray-50"><SkipForward className="h-3.5 w-3.5" /></button>
          </div>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {detail && events.length === 0 && <p className="text-sm text-slate-500">{t("hermes.replay.noEvents")}</p>}

      {events.length > 0 && (
        <>
          <input type="range" min={0} max={events.length - 1} value={Math.min(step, events.length - 1)} id="hermes-replay-step"
            aria-label={t("hermes.replay.step")} onChange={e => { setPlaying(false); setStep(Number(e.target.value)); }}
            className="w-full accent-indigo-600" />

          {total > 0 && (
            <div className="flex flex-col gap-1.5">
              <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                {breakdown.map((b, i) => (
                  <div key={b.holder} style={{ width: `${(b.seconds / total) * 100}%`, background: HOLDER_COLORS[i % HOLDER_COLORS.length] }}
                    title={`${nameOf(b.holder)} · ${formatDuration(b.seconds)}`} />
                ))}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-slate-600">
                {breakdown.map((b, i) => (
                  <span key={b.holder} className="inline-flex items-center gap-1.5">
                    <i className="inline-block h-2 w-2 rounded-full" style={{ background: HOLDER_COLORS[i % HOLDER_COLORS.length] }} />
                    {nameOf(b.holder)} <span className="font-mono tabular-nums">{formatDuration(b.seconds)}</span>
                  </span>
                ))}
                <span className="text-slate-400">{t("hermes.replay.total")} <span className="font-mono tabular-nums">{formatDuration(total)}</span></span>
              </div>
            </div>
          )}

          <ol className="max-h-40 overflow-auto font-mono text-[12px] leading-relaxed">
            {events.map((e, i) => (
              <li key={e.id}>
                <button type="button" onClick={() => { setPlaying(false); setStep(i); }}
                  className={`w-full rounded px-1.5 text-left ${i === step ? "bg-indigo-50 text-indigo-800" : "text-slate-600 hover:bg-slate-50"}`}>
                  <span className="text-slate-400">+{formatDuration(e.createdAt - start)}</span>{" "}
                  <b className="font-medium">{e.kind}</b>{" "}
                  {e.from && e.to ? `${nameOf(e.from)} → ${nameOf(e.to)}` : e.at ? `@ ${nameOf(e.at)}` : ""}
                  {e.summary ? ` · ${e.summary}` : ""}
                </button>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
