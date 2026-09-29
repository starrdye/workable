"use client";

/**
 * HermesView — the /hermes page: a read-only, live map of the local Hermes
 * agent team. Team / Live / Projects / Replay are views of the same graph.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Info, Plus, RefreshCw } from "lucide-react";
import { useHermesSnapshot } from "@/hooks/useHermesSnapshot";
import { HUMAN_ID } from "@/lib/hermes/metrics";
import type { HermesEvent, HermesSnapshot } from "@/lib/hermes/types";
import { TeamCanvas, DOT_COLORS, type HermesMode, type ReplayFocus } from "./TeamCanvas";
import { HermesSidePanel } from "./HermesSidePanel";
import { ReplayPanel } from "./ReplayPanel";
import { EditDialog, type EditRequest } from "./EditDialog";
import { isEmbedded } from "@/lib/embed";
import { LanguageToggle } from "@/components/LanguageToggle";
import { useLanguage } from "@/contexts/LanguageContext";

const MODES: HermesMode[] = ["team", "live", "projects", "replay"];

function clock(sec: number): string {
  return new Date(sec * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function HermesView() {
  const { t } = useLanguage();
  const [mode, setMode] = useState<HermesMode>("live");
  const [board, setBoard] = useState<string | null>(null);
  const [homeId, setHomeId] = useState<string | null>(null);
  const [sample, setSample] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [replayTask, setReplayTask] = useState<string | null>(null);
  const [replayFocus, setReplayFocus] = useState<ReplayFocus | null>(null);
  const [editRequest, setEditRequest] = useState<EditRequest | null>(null);
  const { snapshot, error, loading, lastFetched, refresh } = useHermesSnapshot(board, sample, false, homeId);
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Re-render every second so "updated Ns ago" stays honest.
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const openReplay = useCallback((taskId: string) => {
    setReplayTask(taskId);
    setMode("replay");
  }, []);

  const handleFocus = useCallback((f: ReplayFocus | null) => setReplayFocus(f), []);

  if (!snapshot) {
    return (
      <Shell>
        <div className="mx-auto mt-24 max-w-lg rounded-xl border border-gray-200 bg-white p-6 text-center shadow-sm">
          {loading ? (
            <p className="text-sm text-slate-500">{t("hermes.loading")}</p>
          ) : (
            <>
              <h2 className="mb-2 text-base font-semibold text-slate-800">{t("hermes.error.title")}</h2>
              <p className="text-sm text-slate-600 break-words">{error}</p>
              <button type="button" onClick={refresh} className="mt-4 inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-gray-50">
                <RefreshCw className="h-3.5 w-3.5" />{t("hermes.retry")}
              </button>
            </>
          )}
        </div>
      </Shell>
    );
  }

  const empty = !snapshot.sample && snapshot.tasks.length === 0 && snapshot.events.length === 0;
  // Inside the Hermes window edits are refused (src/proxy.ts), so don't offer them there.
  const embedded = isEmbedded();
  const editable = snapshot.editable && !embedded;
  const ago = lastFetched ? Math.max(0, Math.round((nowMs - lastFetched) / 1000)) : null;
  const stale = !!error;

  return (
    <Shell
      toolbar={
        <>
          <div className="inline-flex rounded-lg bg-slate-100 p-0.5" role="group" aria-label={t("hermes.mode.aria")}>
            {MODES.map(m => (
              <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}
                className={`rounded-md px-3 py-1 text-[13px] font-medium transition-colors ${mode === m ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
                {t(`hermes.mode.${m}` as const)}
              </button>
            ))}
          </div>
          {editable && (
            <button type="button" onClick={() => setEditRequest({ op: "add-agent" })}
              className="inline-flex items-center gap-1 rounded-md border border-indigo-300 bg-indigo-50 px-2.5 py-1 text-[13px] font-medium text-indigo-700 hover:bg-indigo-100">
              <Plus className="h-3.5 w-3.5" />{t("hermes.edit.addAgent")}
            </button>
          )}
          {snapshot.homes.length > 1 && (
            <select aria-label={t("hermes.install")} value={snapshot.homeId}
              onChange={e => { setHomeId(e.target.value); setBoard(null); setSelectedId(null); setReplayTask(null); }}
              className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-slate-700" title={snapshot.home}>
              {snapshot.homes.map(h => <option key={h.id} value={h.id}>{h.label}</option>)}
            </select>
          )}
          {snapshot.boards.length > 1 && (
            <select aria-label={t("hermes.board")} value={snapshot.board?.slug ?? ""} onChange={e => setBoard(e.target.value)}
              className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-slate-700">
              {snapshot.boards.map(b => <option key={b.slug} value={b.slug}>{b.name}</option>)}
            </select>
          )}
          {snapshot.sample && (
            <button type="button" onClick={() => setSample(false)}
              className="rounded-md border border-dashed border-amber-400 px-2 py-0.5 font-mono text-[11px] font-medium text-amber-700 hover:bg-amber-50">
              {t("hermes.sample.badge")} · {t("hermes.sample.hide")}
            </button>
          )}
          <span className={`inline-flex items-center gap-1.5 font-mono text-[11.5px] ${stale ? "text-red-600" : "text-emerald-600"}`}
            title={stale ? error ?? "" : snapshot.home}>
            <i className={`inline-block h-1.5 w-1.5 rounded-full ${stale ? "bg-red-500" : "bg-emerald-500 animate-pulse"}`} />
            {stale ? t("hermes.status.stale") : ago == null ? "" : t("hermes.status.updated").replace("{n}", String(ago))}
          </span>
        </>
      }>

      <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-4 py-4">
        {snapshot.warnings.map(w => (
          <div key={w} className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] text-amber-800">{w}</div>
        ))}
        {empty && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-600">
            <Info className="h-4 w-4 shrink-0 text-indigo-500" />
            <span className="min-w-0 flex-1">{t("hermes.empty").replace("{board}", snapshot.board?.slug ?? "—")}</span>
            <button type="button" onClick={() => setSample(true)}
              className="rounded-md border border-indigo-300 bg-indigo-50 px-2.5 py-1 text-[12.5px] font-medium text-indigo-700 hover:bg-indigo-100">
              {t("hermes.sample.show")}
            </button>
          </div>
        )}

        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px]">
            <div className="blueprint-bg overflow-x-auto bg-slate-50">
              {snapshot.profiles.length ? (
                <TeamCanvas snapshot={snapshot} mode={mode} selectedId={selectedId} onSelect={setSelectedId} replayFocus={replayFocus} />
              ) : (
                <p className="p-8 text-sm text-slate-500">{t("hermes.noProfiles").replace("{home}", snapshot.home)}</p>
              )}
            </div>
            <aside className="border-t border-gray-200 p-4 lg:border-l lg:border-t-0" aria-live="polite">
              {mode === "projects" ? (
                <ProjectsPanel snapshot={snapshot} onAddProject={editable ? () => setEditRequest({ op: "add-project" }) : undefined} />
              ) : (
                <HermesSidePanel snapshot={snapshot} selectedId={selectedId} onOpenReplay={openReplay}
                  onEdit={editable ? profile => setEditRequest({ op: "edit-agent", profile }) : undefined} />
              )}
            </aside>
          </div>

          {mode === "live" && (
            <>
              <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-gray-200 px-4 py-2 text-[12px] text-slate-500">
                {(["todo", "in-progress", "review", "blocked", "done"] as const).map(s => (
                  <span key={s} className="inline-flex items-center gap-1.5">
                    <i className="inline-block h-2 w-2 rounded-full" style={{ background: DOT_COLORS[s] }} />{t(`hermes.dot.${s}` as const)}
                  </span>
                ))}
                <span className="inline-flex items-center gap-1.5"><i className="inline-block h-2 w-2 rounded-full bg-amber-400" />{t("hermes.legend.bottleneck")}</span>
              </div>
              <EventTicker snapshot={snapshot} onOpenReplay={openReplay} />
            </>
          )}
          {mode === "replay" && (
            <ReplayPanel snapshot={snapshot} taskId={replayTask} onTaskChange={setReplayTask} onFocus={handleFocus} />
          )}
        </div>

        <p className="text-[12px] text-slate-400">
          {(editable ? t("hermes.footer.editable") : embedded && snapshot.editable ? t("hermes.footer.embedded") : t("hermes.footer")).replace("{home}", snapshot.home)}
        </p>
      </div>
      {editRequest && (
        <EditDialog request={editRequest} snapshot={snapshot} onClose={() => setEditRequest(null)} onApplied={refresh} />
      )}
    </Shell>
  );
}

function Shell({ children, toolbar }: { children: React.ReactNode; toolbar?: React.ReactNode }) {
  const { t } = useLanguage();
  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <header className="sticky top-0 z-40 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-gray-200 bg-white px-4 py-2.5 shadow-sm">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
          <ArrowLeft className="h-4 w-4" />{t("hermes.back")}
        </Link>
        <div className="flex items-center gap-2 text-sm font-semibold">
          <span className="h-4 w-4 rounded bg-indigo-600" aria-hidden="true" />
          Workable <span className="font-normal text-slate-400">/ Hermes</span>
        </div>
        <div className="flex flex-1 flex-wrap items-center justify-end gap-3">
          {toolbar}
          <LanguageToggle />
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}

function EventTicker({ snapshot, onOpenReplay }: { snapshot: HermesSnapshot; onOpenReplay: (id: string) => void }) {
  const { t } = useLanguage();
  const name = (id: string | null) => {
    if (!id) return "—";
    if (id === HUMAN_ID || !snapshot.profiles.some(p => p.id === id)) return t("hermes.you");
    return id.replace(/^personal-/, "");
  };
  const line = (e: HermesEvent) => e.from && e.to ? `${name(e.from)} → ${name(e.to)}` : name(e.at);
  if (!snapshot.events.length) {
    return <p className="border-t border-gray-200 px-4 py-2.5 font-mono text-[12px] text-slate-400">{t("hermes.ticker.empty")}</p>;
  }
  return (
    <ol className="max-h-36 overflow-auto border-t border-gray-200 px-4 py-2 font-mono text-[12px] leading-[1.8] text-slate-500" aria-label={t("hermes.ticker.aria")}>
      {snapshot.events.slice(0, 30).map(e => (
        <li key={e.id} className="truncate">
          <span className="text-slate-400">{clock(e.createdAt)}</span>{" "}
          <b className="font-medium text-slate-700">{line(e)}</b>{" "}
          {e.kind === "chat_message" ? t("hermes.ticker.asked") : e.kind === "chat_reply" ? t("hermes.ticker.replied") : e.kind}{" "}
          {e.kind.startsWith("chat_") ? null : (
            <button type="button" onClick={() => onOpenReplay(e.taskId)} className="text-indigo-600 hover:underline">{e.taskId}</button>
          )}
          {` "${e.taskTitle}"`}{e.summary ? ` · ${e.summary}` : ""}
        </li>
      ))}
    </ol>
  );
}

function ProjectsPanel({ snapshot, onAddProject }: { snapshot: HermesSnapshot; onAddProject?: () => void }) {
  const { t } = useLanguage();
  const boardOf = (slug: string | null) => snapshot.boards.find(b => b.slug === slug);
  return (
    <div className="flex flex-col gap-4 text-[13px]">
      <div>
        <div className="text-[11px] font-medium uppercase tracking-wider text-slate-500">{t("hermes.projects.boards")}</div>
        <ul className="mt-1.5 flex flex-col gap-1.5">
          {snapshot.boards.map(b => (
            <li key={b.slug} className={`rounded-lg px-2.5 py-2 ${b.slug === snapshot.board?.slug ? "bg-indigo-50 text-indigo-800" : "bg-slate-50 text-slate-700"}`}>
              <div className="font-mono text-xs font-medium">{b.slug}</div>
              {b.description && <div className="text-[12px] text-slate-500">{b.description}</div>}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <div className="text-[11px] font-medium uppercase tracking-wider text-slate-500">{t("hermes.projects.title")}</div>
        {snapshot.projects.length === 0 && <p className="mt-1.5 text-slate-500">{t("hermes.projects.none")}</p>}
        <ul className="mt-1.5 flex flex-col gap-1.5">
          {snapshot.projects.map(p => (
            <li key={p.id} className="rounded-lg bg-slate-50 px-2.5 py-2 text-slate-700">
              <div className="flex items-center gap-1.5 font-medium">
                <i className="inline-block h-2 w-2 rounded-full" style={{ background: p.color || "#94A3B8" }} />{p.name}
              </div>
              <div className="font-mono text-[11.5px] text-slate-500">
                {p.boardSlug ? `${t("hermes.board")}: ${boardOf(p.boardSlug)?.slug ?? p.boardSlug}` : t("hermes.projects.unbound")}
              </div>
            </li>
          ))}
        </ul>
      </div>
      {onAddProject && (
        <button type="button" onClick={onAddProject}
          className="inline-flex items-center justify-center gap-1 rounded-md border border-indigo-300 bg-indigo-50 px-2.5 py-1.5 text-[13px] font-medium text-indigo-700 hover:bg-indigo-100">
          <Plus className="h-3.5 w-3.5" />{t("hermes.edit.addProject")}
        </button>
      )}
      <p className="rounded-lg border border-slate-200 px-2.5 py-2 text-[12px] leading-relaxed text-slate-500">{t("hermes.projects.note")}</p>
    </div>
  );
}
