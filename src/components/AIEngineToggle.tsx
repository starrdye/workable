'use client';

/**
 * components/AIEngineToggle.tsx — Pill toggle for switching AI engine mode.
 *
 * Renders a compact pill with two segments: "Mono" | "Dist".
 * Completely self-contained — reads/writes via useAIEngineMode().
 */

import { useAIEngineMode, type AIEngineMode } from '@/contexts/AIEngineContext';

interface AIEngineToggleProps {
  /** Optional: compact mode for toolbar embedding */
  compact?: boolean;
  /** Optional: additional CSS class */
  className?: string;
}

export function AIEngineToggle({ compact = false, className = '' }: AIEngineToggleProps) {
  const { mode, setMode } = useAIEngineMode();

  const options: Array<{ value: AIEngineMode; label: string; shortLabel: string }> = [
    { value: 'monolithic',  label: 'Monolithic',  shortLabel: 'Mono' },
    { value: 'distributed', label: 'Distributed', shortLabel: 'Dist' },
  ];

  return (
    <div
      className={`inline-flex items-center rounded-full border border-slate-200 bg-slate-100 p-0.5 gap-0.5 ${className}`}
      role="radiogroup"
      aria-label="AI Engine Mode"
    >
      {options.map(opt => {
        const isActive = mode === opt.value;
        return (
          <button
            key={opt.value}
            role="radio"
            aria-checked={isActive}
            onClick={() => setMode(opt.value)}
            title={`Switch to ${opt.label} AI engine`}
            className={`
              px-3 py-1 rounded-full text-xs font-semibold transition-all duration-200
              ${isActive
                ? opt.value === 'monolithic'
                  ? 'bg-white text-indigo-600 shadow-sm border border-indigo-100'
                  : 'bg-white text-emerald-600 shadow-sm border border-emerald-100'
                : 'text-slate-400 hover:text-slate-600'}
            `}
          >
            {compact ? opt.shortLabel : opt.label}
          </button>
        );
      })}
    </div>
  );
}
