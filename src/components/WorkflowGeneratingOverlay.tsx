"use client";

/**
 * WorkflowGeneratingOverlay.tsx — Track 15a: Optimistic Canvas Entry
 *
 * Full-screen overlay shown over the empty canvas while the AI generates
 * a new workflow. Transitions the user out of the frozen start-screen wait
 * and into an active "building" state immediately on click.
 *
 * Stage progression is time-estimated (typical parse-workflow call ≈ 12–25 s).
 * Each stage activates based on elapsed fraction so the bar always moves,
 * giving continuous feedback even if the AI is slow.
 *
 * Error state: if generation fails, the overlay switches to an error card
 * with a "Back to start" button — no hard page reload required.
 */

import { useEffect, useState, useRef } from "react";
import { Loader2, Sparkles, AlertCircle, ArrowLeft } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import type { TranslationKey } from "@/lib/i18n";

// ── Stage definitions ─────────────────────────────────────────────────────────

interface Stage {
  labelKey: TranslationKey;
  /** Fraction of estimated total time when this stage becomes active (0–1) */
  startFraction: number;
}

const STAGES: Stage[] = [
  { labelKey: "generating.stage0", startFraction: 0.00 },
  { labelKey: "generating.stage1", startFraction: 0.30 },
  { labelKey: "generating.stage2", startFraction: 0.58 },
  { labelKey: "generating.stage3", startFraction: 0.80 },
  { labelKey: "generating.stage4", startFraction: 0.93 },
];

/** Typical end-to-end duration in ms for a parse-workflow AI call */
const ESTIMATED_DURATION_MS = 20_000;

// ── Props ─────────────────────────────────────────────────────────────────────

export interface WorkflowGeneratingOverlayProps {
  /** When true the overlay is rendered and the timer runs */
  isVisible: boolean;
  /**
   * When set, switches to the error state.
   * The overlay stays mounted so the user can read the message and go back.
   */
  error?: string | null;
  /** Called when the user clicks "Back to start" on the error card */
  onDismissError?: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function WorkflowGeneratingOverlay({
  isVisible,
  error,
  onDismissError,
}: WorkflowGeneratingOverlayProps) {
  const { t } = useLanguage();
  const startTimeRef = useRef(Date.now());
  const [elapsed, setElapsed] = useState(0);

  // Reset timer each time the overlay becomes visible
  useEffect(() => {
    if (isVisible && !error) {
      startTimeRef.current = Date.now();
      setElapsed(0);
      const id = setInterval(() => {
        setElapsed(Date.now() - startTimeRef.current);
      }, 120);
      return () => clearInterval(id);
    }
  }, [isVisible, error]);

  if (!isVisible) return null;

  // ── Error state ─────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="absolute inset-0 z-[300] flex items-center justify-center bg-white/90 backdrop-blur-sm">
        <div className="bg-white rounded-3xl shadow-2xl border border-red-100 px-10 py-10 max-w-md w-full mx-4 flex flex-col items-center gap-6 text-center">
          <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center">
            <AlertCircle className="w-7 h-7 text-red-500" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-800 mb-2">{t('generating.failed')}</h3>
            <p className="text-sm text-slate-500 leading-relaxed">{error}</p>
          </div>
          <button
            onClick={onDismissError}
            className="flex items-center gap-2 px-6 py-2.5 rounded-full bg-slate-800 text-white text-sm font-semibold hover:bg-slate-700 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            {t('generating.backToStart')}
          </button>
        </div>
      </div>
    );
  }

  // ── Progress state ──────────────────────────────────────────────────────────
  // Cap at 97 % so the bar never reaches 100 % while waiting
  const fraction        = Math.min(elapsed / ESTIMATED_DURATION_MS, 0.97);
  const activeStageIdx  = STAGES.reduce<number>((active, stage, i) =>
    stage.startFraction <= fraction ? i : active, 0);

  return (
    <div className="absolute inset-0 z-[300] flex items-center justify-center bg-white/85 backdrop-blur-sm">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-100 px-10 py-9 max-w-sm w-full mx-4 flex flex-col gap-7">

        {/* ── Header ── */}
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-full bg-indigo-100 flex items-center justify-center shrink-0">
            <Sparkles className="w-5 h-5 text-indigo-600 animate-pulse" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-800 leading-tight">{t('generating.title')}</h3>
            <p className="text-xs text-slate-400 mt-0.5">{t('generating.subtitle')}</p>
          </div>
        </div>

        {/* ── Stage list ── */}
        <div className="flex flex-col gap-3.5">
          {STAGES.map((stage, i) => {
            const isDone   = i < activeStageIdx;
            const isActive = i === activeStageIdx;
            const isPending = i > activeStageIdx;
            return (
              <div key={i} className={`flex items-center gap-3 transition-opacity duration-300 ${isPending ? "opacity-30" : ""}`}>
                {/* Status dot */}
                <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 transition-all ${
                  isDone   ? "bg-emerald-100"
                  : isActive ? "bg-indigo-100"
                  : "bg-slate-100"
                }`}>
                  {isDone ? (
                    <svg className="w-3 h-3 text-emerald-600" viewBox="0 0 12 12" fill="none">
                      <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.8"
                        strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : isActive ? (
                    <Loader2 className="w-3 h-3 text-indigo-600 animate-spin" />
                  ) : (
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-300 block" />
                  )}
                </div>

                {/* Label */}
                <span className={`text-sm font-medium leading-snug ${
                  isDone   ? "text-emerald-600"
                  : isActive ? "text-slate-800"
                  : "text-slate-400"
                }`}>
                  {t(stage.labelKey)}
                </span>
              </div>
            );
          })}
        </div>

        {/* ── Progress bar ── */}
        <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-indigo-500 to-violet-500 rounded-full transition-all duration-500 ease-out"
            style={{ width: `${Math.round(fraction * 100)}%` }}
          />
        </div>

      </div>
    </div>
  );
}

// ── Skeleton canvas (Track 15c preview) ──────────────────────────────────────
/**
 * Lightweight placeholder nodes rendered behind the overlay.
 * Gives the spatial affordance that "a graph is being built here."
 * Used inside the main canvas container when isGeneratingWorkflow=true.
 */
export function SkeletonCanvas() {
  // 10 placeholder positions distributed across the canvas area
  const placeholders = [
    { x: "15%",  y: "35%" },
    { x: "30%",  y: "18%" },
    { x: "30%",  y: "55%" },
    { x: "47%",  y: "35%" },
    { x: "47%",  y: "65%" },
    { x: "62%",  y: "22%" },
    { x: "62%",  y: "50%" },
    { x: "75%",  y: "38%" },
    { x: "85%",  y: "20%" },
    { x: "85%",  y: "58%" },
  ];

  return (
    <div className="absolute inset-0 z-[290] pointer-events-none overflow-hidden">
      {/* Faint connecting lines */}
      <svg className="absolute inset-0 w-full h-full opacity-20" xmlns="http://www.w3.org/2000/svg">
        <line x1="15%" y1="35%" x2="30%" y2="18%" stroke="#94A3B8" strokeWidth="1.5" />
        <line x1="15%" y1="35%" x2="30%" y2="55%" stroke="#94A3B8" strokeWidth="1.5" />
        <line x1="30%" y1="18%" x2="47%" y2="35%" stroke="#94A3B8" strokeWidth="1.5" />
        <line x1="30%" y1="55%" x2="47%" y2="65%" stroke="#94A3B8" strokeWidth="1.5" />
        <line x1="47%" y1="35%" x2="62%" y2="22%" stroke="#94A3B8" strokeWidth="1.5" />
        <line x1="47%" y1="65%" x2="62%" y2="50%" stroke="#94A3B8" strokeWidth="1.5" />
        <line x1="62%" y1="22%" x2="75%" y2="38%" stroke="#94A3B8" strokeWidth="1.5" />
        <line x1="62%" y1="50%" x2="75%" y2="38%" stroke="#94A3B8" strokeWidth="1.5" />
        <line x1="75%" y1="38%" x2="85%" y2="20%" stroke="#94A3B8" strokeWidth="1.5" />
        <line x1="75%" y1="38%" x2="85%" y2="58%" stroke="#94A3B8" strokeWidth="1.5" />
      </svg>

      {/* Placeholder node circles */}
      {placeholders.map((pos, i) => (
        <div
          key={i}
          className="absolute -translate-x-1/2 -translate-y-1/2 w-12 h-12 rounded-full border-2 border-slate-200 bg-slate-100 animate-pulse"
          style={{
            left: pos.x,
            top:  pos.y,
            animationDelay: `${i * 0.12}s`,
            animationDuration: "1.8s",
          }}
        />
      ))}
    </div>
  );
}
