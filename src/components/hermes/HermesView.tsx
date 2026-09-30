"use client";

/**
 * HermesView — the /hermes page: a read-only, live map of the local Hermes
 * agent team. Team / Live / Projects / Replay are views of the same graph.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronRight, Info, Plus, RefreshCw } from "lucide-react";
import { useHermesSnapshot } from "@/hooks/useHermesSnapshot";
import type { HermesSnapshot } from "@/lib/hermes/types";
import { TeamCanvas, type HermesMode, type ReplayFocus } from "./TeamCanvas";
import { TeamRoster } from "./TeamRoster";
import { RequestsTable } from "./RequestsTable";
import { type HermesMode as ThemeMode } from "@/lib/hermes/theme";
import { useEmbedded, useHermesTheme } from "@/lib/hermes/useHermesTheme";
import type { CSSProperties } from "react";
import { HermesSidePanel } from "./HermesSidePanel";
import { ReplayPanel } from "./ReplayPanel";
import { EditDialog, type EditRequest } from "./EditDialog";
import { LanguageToggle } from "@/components/LanguageToggle";
import { useLanguage } from "@/contexts/LanguageContext";

const MODES: HermesMode[] = ["team", "live", "projects", "replay"];

export function HermesView() {
  const { t } = useLanguage();
  const [mode, setMode] = useState<HermesMode>("live");
  const [board, setBoard] = useState<string | null>(null);
  const [homeId, setHomeId] = useState<string | null>(null);
  const [sample, setSample] = useState(false);
  // ?agent=<id> preselects an agent (the Hermes status-bar chip and floating card link here).
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("agent"));
  const detailsRef = useRef<HTMLElement>(null);
  const [replayTask, setReplayTask] = useState<string | null>(null);
  const [replayFocus, setReplayFocus] = useState<ReplayFocus | null>(null);
  const [editRequest, setEditRequest] = useState<EditRequest | null>(null);
  const { snapshot, error, loading, lastFetched, connection, refresh } = useHermesSnapshot(board, sample, false, homeId);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const theme = useHermesTheme();
  const embedded = useEmbedded();
  const [narrow, setNarrow] = useState(false);
  const mapRef = useRef<HTMLDivElement>(null);

  // Below ~620px the map's text gets too small, so show the roster instead.
  const hasData = !!snapshot;
  useEffect(() => {
    const el = mapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    // Measure now too: the observer's first callback can arrive late (or not at all in
    // some embedded/headless frames), which left the 560px-wide map clipped at 480px.
    setNarrow(el.clientWidth < 620);
    const ro = new ResizeObserver(([entry]) => setNarrow(entry.contentRect.width < 620));
    ro.observe(el);
    return () => ro.disconnect();
    // The map container only exists once the first snapshot has arrived.
  }, [hasData]);

  // Re-render every second so "updated Ns ago" stays honest.
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const openReplay = useCallback((taskId: string) => {
    setReplayTask(taskId);
    setMode("replay");
  }, []);

  // Select an agent; in the single-column layout, bring its details into view.
  const selectAgent = useCallback((id: string) => {
    setSelectedId(id);
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches) {
      requestAnimationFrame(() => detailsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  }, []);

  const handleFocus = useCallback((f: ReplayFocus | null) => setReplayFocus(f), []);

  if (!snapshot) {
    return (
      <Shell theme={theme} embedded={embedded}>
        <div className="mx-auto mt-24 max-w-lg rounded-xl border border-(--h-border) bg-(--h-surface) p-6 text-center">
          {loading ? (
            <p className="text-sm text-(--h-muted)">{t("hermes.loading")}</p>
          ) : (
            <>
              <h2 className="mb-2 text-base font-semibold text-(--h-text)">{t("hermes.error.title")}</h2>
              <p className="text-sm text-(--h-muted) break-words">{error}</p>
              <button type="button" onClick={refresh} className="mt-4 inline-flex items-center gap-1.5 rounded-md border border-(--h-border) px-3 py-1.5 text-sm text-(--h-text-2) hover:bg-(--h-sunk)">
                <RefreshCw className="h-3.5 w-3.5" />{t("hermes.retry")}
              </button>
            </>
          )}
        </div>
      </Shell>
    );
  }

  const chatting = (snapshot.activity ?? []).some(a => a.chats24h > 0);
  const empty = !snapshot.sample && snapshot.tasks.length === 0 && snapshot.events.length === 0 && !chatting;
  // Inside the Hermes window edits are refused (src/proxy.ts), so don't offer them there.
  const editable = snapshot.editable && !embedded;
  const ago = lastFetched ? Math.max(0, Math.round((nowMs - lastFetched) / 1000)) : null;
  const stale = !!error;

  return (
    <Shell theme={theme} embedded={embedded}
      toolbar={
        <>
          <div className="inline-flex rounded-lg bg-(--h-sunk) p-0.5" role="group" aria-label={t("hermes.mode.aria")}>
            {MODES.map(m => (
              <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}
                className={`rounded-md px-2.5 py-1 text-[12.5px] font-medium transition-colors ${mode === m ? "bg-(--h-surface) text-(--h-text) shadow-sm" : "text-(--h-muted) hover:text-(--h-text)"}`}>
                {t(`hermes.mode.${m}` as const)}
              </button>
            ))}
          </div>
          {(snapshot.homes.length > 1 || snapshot.boards.length > 1) && (
            <div className="inline-flex items-center rounded-lg border border-(--h-border) bg-(--h-surface) text-[12.5px]" title={snapshot.home}>
              {snapshot.homes.length > 1 ? (
                <select aria-label={t("hermes.install")} value={snapshot.homeId}
                  onChange={e => { setHomeId(e.target.value); setBoard(null); setSelectedId(null); setReplayTask(null); }}
                  className="bg-transparent py-1 pl-2 pr-1 font-medium text-(--h-text) outline-none">
                  {snapshot.homes.map(h => <option key={h.id} value={h.id}>{h.label}</option>)}
                </select>
              ) : <span className="px-2 font-medium text-(--h-text)">{snapshot.homes[0]?.label}</span>}
              <ChevronRight className="h-3.5 w-3.5 text-(--h-faint)" aria-hidden="true" />
              {snapshot.boards.length > 1 ? (
                <select aria-label={t("hermes.board")} value={snapshot.board?.slug ?? ""} onChange={e => setBoard(e.target.value)}
                  className="bg-transparent py-1 pl-1 pr-1 text-(--h-muted) outline-none">
                  {snapshot.boards.map(b => <option key={b.slug} value={b.slug}>{b.name}</option>)}
                </select>
              ) : <span className="py-1 pl-1 pr-2 text-(--h-muted)">{snapshot.board?.name ?? "—"}</span>}
            </div>
          )}
          {editable && (
            <button type="button" onClick={() => setEditRequest({ op: "add-agent" })}
              className="inline-flex items-center gap-1 rounded-lg bg-(--h-accent-soft) px-2.5 py-1 text-[12.5px] font-medium text-(--h-accent) hover:opacity-90">
              <Plus className="h-3.5 w-3.5" />{t("hermes.edit.addAgent")}
            </button>
          )}
          {snapshot.sample && (
            <button type="button" onClick={() => setSample(false)}
              className="rounded-md border border-dashed border-(--h-warn) px-2 py-0.5 font-mono text-[11px] font-medium text-(--h-warn)">
              {t("hermes.sample.badge")} · {t("hermes.sample.hide")}
            </button>
          )}
          <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium" style={{ color: stale ? "var(--h-bad)" : "var(--h-ok)" }}
            title={stale ? error ?? "" : snapshot.home}>
            <i className={`inline-block h-1.5 w-1.5 rounded-full ${stale ? "" : "animate-pulse"}`} style={{ background: stale ? "var(--h-bad)" : "var(--h-ok)" }} />
            {stale ? t("hermes.status.stale") : connection === "live" ? t("hermes.conn.live")
              : ago == null ? "" : `${t("hermes.conn.polling")} · ${t("hermes.status.updated").replace("{n}", String(ago))}`}
          </span>
        </>
      }>

      <div className={`mx-auto flex w-full max-w-7xl flex-col gap-3 ${embedded ? "px-2 py-2" : "px-4 py-4"}`}>
        {snapshot.warnings.map(w => (
          <div key={w} className="rounded-lg bg-(--h-warn-soft) px-3 py-2 text-[13px] text-(--h-warn)">{w}</div>
        ))}
        {empty && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-(--h-border) bg-(--h-surface) px-3 py-2 text-[13px] text-(--h-muted)">
            <Info className="h-4 w-4 shrink-0 text-(--h-accent)" />
            <span className="min-w-0 flex-1">{t("hermes.empty").replace("{board}", snapshot.board?.slug ?? "—")}</span>
            <button type="button" onClick={() => setSample(true)}
              className="rounded-md bg-(--h-accent-soft) px-2.5 py-1 text-[12.5px] font-medium text-(--h-accent)">
              {t("hermes.sample.show")}
            </button>
          </div>
        )}

        <div className="overflow-hidden rounded-xl border border-(--h-border) bg-(--h-surface)">
          {/* Wide: map + requests on the left, details on the right. Single column:
              map → details → requests, so a click's details show right under the map. */}
          <div className="hermes-layout">
            <div className="min-w-0" style={{ gridArea: "map" }}>
              <div ref={mapRef} className="hermes-dots overflow-x-auto bg-(--h-bg)">
                {!snapshot.profiles.length ? (
                  <p className="p-8 text-sm text-(--h-muted)">{t("hermes.noProfiles").replace("{home}", snapshot.home)}</p>
                ) : narrow && (mode === "team" || mode === "live") ? (
                  <TeamRoster snapshot={snapshot} selectedId={selectedId} onSelect={selectAgent} />
                ) : (
                  <TeamCanvas snapshot={snapshot} mode={mode} selectedId={selectedId} onSelect={selectAgent} replayFocus={replayFocus} />
                )}
              </div>
            </div>
            {mode === "live" && (
              <div className="min-w-0 border-t border-(--h-border)" style={{ gridArea: "req" }}>
                <RequestsTable snapshot={snapshot} onOpenCard={openReplay} onSelect={selectAgent} nowMs={nowMs} />
              </div>
            )}
            <aside ref={detailsRef} className="scroll-mt-28 border-t border-(--h-border) p-4 lg:border-l lg:border-t-0" style={{ gridArea: "side" }} aria-live="polite">
              {mode === "projects" ? (
                <ProjectsPanel snapshot={snapshot} onAddProject={editable ? () => setEditRequest({ op: "add-project" }) : undefined} />
              ) : (
                <HermesSidePanel snapshot={snapshot} selectedId={selectedId} onOpenReplay={openReplay}
                  onEdit={editable ? profile => setEditRequest({ op: "edit-agent", profile }) : undefined} />
              )}
            </aside>
          </div>

          {mode === "replay" && (
            <ReplayPanel snapshot={snapshot} taskId={replayTask} onTaskChange={setReplayTask} onFocus={handleFocus} />
          )}
        </div>

        {!embedded && <p className="text-[12px] text-(--h-faint)">
          {(editable ? t("hermes.footer.editable") : embedded && snapshot.editable ? t("hermes.footer.embedded") : t("hermes.footer")).replace("{home}", snapshot.home)}
        </p>}
      </div>
      {editRequest && (
        <EditDialog request={editRequest} snapshot={snapshot} onClose={() => setEditRequest(null)} onApplied={refresh} />
      )}
    </Shell>
  );
}

function Shell({ children, toolbar, theme, embedded }: {
  children: React.ReactNode; toolbar?: React.ReactNode; theme: { mode: ThemeMode; style: CSSProperties }; embedded: boolean;
}) {
  const { t } = useLanguage();
  return (
    <div className="hermes-root min-h-screen" data-mode={theme.mode} style={theme.style}>
      {embedded ? (
        // Inside the Hermes window: the pane's own title bar is the header, so only the controls remain.
        <header className="sticky top-0 z-40 flex flex-wrap items-center gap-2 border-b border-(--h-border) bg-(--h-surface) px-2 py-1.5">
          {toolbar}
        </header>
      ) : (
        <header className="sticky top-0 z-40 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-(--h-border) bg-(--h-surface) px-4 py-2.5">
          <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-(--h-muted) hover:text-(--h-text)">
            <ArrowLeft className="h-4 w-4" />{t("hermes.back")}
          </Link>
          <div className="flex items-center gap-2 text-sm font-semibold text-(--h-text)">
            <span className="h-4 w-4 rounded bg-(--h-accent)" aria-hidden="true" />
            Workable <span className="font-normal text-(--h-faint)">/ Hermes</span>
          </div>
          <div className="flex flex-1 flex-wrap items-center justify-end gap-3">
            {toolbar}
            <LanguageToggle />
          </div>
        </header>
      )}
      <main>{children}</main>
    </div>
  );
}

function ProjectsPanel({ snapshot, onAddProject }: { snapshot: HermesSnapshot; onAddProject?: () => void }) {
  const { t } = useLanguage();
  const boardOf = (slug: string | null) => snapshot.boards.find(b => b.slug === slug);
  return (
    <div className="flex flex-col gap-4 text-[13px]">
      <div>
        <div className="text-[11px] font-medium uppercase tracking-wider text-(--h-muted)">{t("hermes.projects.boards")}</div>
        <ul className="mt-1.5 flex flex-col gap-1.5">
          {snapshot.boards.map(b => (
            <li key={b.slug} className={`rounded-lg px-2.5 py-2 ${b.slug === snapshot.board?.slug ? "bg-(--h-accent-soft) text-(--h-accent)" : "bg-(--h-sunk) text-(--h-text-2)"}`}>
              <div className="font-mono text-xs font-medium">{b.slug}</div>
              {b.description && <div className="text-[12px] text-(--h-muted)">{b.description}</div>}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <div className="text-[11px] font-medium uppercase tracking-wider text-(--h-muted)">{t("hermes.projects.title")}</div>
        {snapshot.projects.length === 0 && <p className="mt-1.5 text-(--h-muted)">{t("hermes.projects.none")}</p>}
        <ul className="mt-1.5 flex flex-col gap-1.5">
          {snapshot.projects.map(p => (
            <li key={p.id} className="rounded-lg bg-(--h-sunk) px-2.5 py-2 text-(--h-text-2)">
              <div className="flex items-center gap-1.5 font-medium">
                <i className="inline-block h-2 w-2 rounded-full" style={{ background: p.color || "#94A3B8" }} />{p.name}
              </div>
              <div className="font-mono text-[11.5px] text-(--h-muted)">
                {p.boardSlug ? `${t("hermes.board")}: ${boardOf(p.boardSlug)?.slug ?? p.boardSlug}` : t("hermes.projects.unbound")}
              </div>
            </li>
          ))}
        </ul>
      </div>
      {onAddProject && (
        <button type="button" onClick={onAddProject}
          className="inline-flex items-center justify-center gap-1 rounded-md bg-(--h-accent-soft) px-2.5 py-1.5 text-[13px] font-medium text-(--h-accent)">
          <Plus className="h-3.5 w-3.5" />{t("hermes.edit.addProject")}
        </button>
      )}
      <p className="rounded-lg border border-(--h-border) px-2.5 py-2 text-[12px] leading-relaxed text-(--h-muted)">{t("hermes.projects.note")}</p>
    </div>
  );
}
