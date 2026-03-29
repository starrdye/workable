'use client';

/**
 * contexts/AIEngineContext.tsx — Global toggle between Monolithic and Distributed AI engines.
 *
 * Design pattern: Strategy pattern via React Context.
 * - The context stores the active mode and a generation counter.
 * - The generation counter increments on every mode switch, allowing the
 *   useAIEngine hook to detect stale in-flight requests and abort them.
 * - Preference persists to localStorage so it survives page reloads.
 */

import { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';
import type { ReactNode } from 'react';

// ── Types ────────────────────────────────────────────────────────────────────

export type AIEngineMode = 'monolithic' | 'distributed';

interface AIEngineContextValue {
  /** Current engine mode */
  mode: AIEngineMode;
  /** Toggle between modes. Returns the new mode. */
  toggleMode: () => AIEngineMode;
  /** Set a specific mode */
  setMode: (mode: AIEngineMode) => void;
  /**
   * Monotonically increasing counter — bumped on every mode change.
   * Used by useAIEngine to detect and abort stale in-flight requests.
   */
  generation: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'nwt_ai_engine_mode';
const DEFAULT_MODE: AIEngineMode = 'monolithic';

// ── Context ──────────────────────────────────────────────────────────────────

const AIEngineContext = createContext<AIEngineContextValue | null>(null);

// ── Provider ─────────────────────────────────────────────────────────────────

export function AIEngineProvider({ children }: { children: ReactNode }) {
  // Static initial value — real value loaded in useEffect to avoid hydration mismatch
  const [mode, setModeState] = useState<AIEngineMode>(DEFAULT_MODE);
  const [generation, setGeneration] = useState(0);

  // Load persisted preference (client-only)
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'monolithic' || stored === 'distributed') {
        setModeState(stored);
      }
    } catch {
      // localStorage unavailable — keep default
    }
  }, []);

  const setMode = useCallback((newMode: AIEngineMode) => {
    setModeState(newMode);
    setGeneration(g => g + 1);
    try { localStorage.setItem(STORAGE_KEY, newMode); } catch { /* noop */ }
  }, []);

  const toggleMode = useCallback(() => {
    const next: AIEngineMode = mode === 'monolithic' ? 'distributed' : 'monolithic';
    setMode(next);
    return next;
  }, [mode, setMode]);

  const value = useMemo<AIEngineContextValue>(
    () => ({ mode, toggleMode, setMode, generation }),
    [mode, toggleMode, setMode, generation],
  );

  return (
    <AIEngineContext.Provider value={value}>
      {children}
    </AIEngineContext.Provider>
  );
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useAIEngineMode(): AIEngineContextValue {
  const ctx = useContext(AIEngineContext);
  if (!ctx) {
    throw new Error('useAIEngineMode must be used within <AIEngineProvider>');
  }
  return ctx;
}
