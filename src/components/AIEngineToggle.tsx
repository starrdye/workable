'use client';

/**
 * components/AIEngineToggle.tsx — Pill toggle for switching AI engine mode.
 *
 * Renders a compact pill with two segments: "Mono" | "Distributed".
 * Shows a warning toast when toggling while a request may be in flight.
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
      className={`inline-flex items-center rounded-full bg-gray-800 p-0.5 ${className}`}
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
            className={`
              px-3 py-1 text-xs font-medium rounded-full transition-all duration-200
              ${isActive
                ? opt.value === 'monolithic'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-emerald-600 text-white shadow-sm'
                : 'text-gray-400 hover:text-gray-200'}
            `}
            title={`Switch to ${opt.label} AI engine`}
          >
            {compact ? opt.shortLabel : opt.label}
          </button>
        );
      })}
    </div>
  );
}
