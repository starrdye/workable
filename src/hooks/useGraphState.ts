// src/hooks/useGraphState.ts
// Owns the server-state polling loop and exposes fullServerState + setter.
// Track 8b: polling hook
// Track 1:  localStorage auto-save + hydration
// Track 3:  SSE real-time sync with 3s poll fallback

import { useState, useEffect, useRef, useCallback } from 'react';
import type { ServerGraphState } from '@/lib/serverState';

const LS_KEY = 'workable_current_state';
const POLL_INTERVAL_MS = 3000;
const AUTOSAVE_DEBOUNCE_MS = 500;

/** Persist state to localStorage (debounced). */
function autosave(
  state: ServerGraphState,
  timerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>,
) {
  if (timerRef.current) clearTimeout(timerRef.current);
  timerRef.current = setTimeout(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch { /* quota exceeded */ }
  }, AUTOSAVE_DEBOUNCE_MS);
}

/** Read persisted state from localStorage. */
function loadCached(): ServerGraphState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as ServerGraphState) : null;
  } catch { return null; }
}

/** Return true if the state has meaningful user-created content. */
function hasContent(s: ServerGraphState | null): boolean {
  return !!s && ((s.customNodes?.length ?? 0) > 0 || (s.customEdges?.length ?? 0) > 0);
}

export function useGraphState() {
  const [fullServerState, setFullServerStateRaw] = useState<ServerGraphState | null>(null);
  const lastPollTs    = useRef(0);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sseRef        = useRef<EventSource | null>(null);

  // Wrap setter so every update also triggers an autosave.
  // Returns a React.Dispatch-compatible setter (accepts T | null | (prev => T | null)).
  const setFullServerState = useCallback(
    (s: ServerGraphState | null | ((prev: ServerGraphState | null) => ServerGraphState | null)) => {
      setFullServerStateRaw(prev => {
        const next = typeof s === 'function' ? s(prev) : s;
        if (next) autosave(next, autosaveTimer);
        return next;
      });
    },
    [],
  );

  // Fetch full state and update
  const fetchFull = useCallback(async () => {
    try {
      const res = await fetch(`/api/graph-state?since=${lastPollTs.current}`);
      const data: ServerGraphState & { unchanged?: boolean } = await res.json();
      if (data.unchanged) return;
      lastPollTs.current = data.lastUpdated;
      setFullServerStateRaw(data);
      autosave(data, autosaveTimer);
    } catch { /* network error — skip */ }
  }, []);

  // Hydrate from localStorage if server is empty, then start SSE / polling
  useEffect(() => {
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let mounted = true;

    async function init() {
      // Initial fetch
      const res = await fetch('/api/graph-state').catch(() => null);
      if (!res || !mounted) return;
      const serverState: ServerGraphState = await res.json().catch(() => null);

      if (serverState) {
        lastPollTs.current = serverState.lastUpdated;

        // Track 1: If server is empty, hydrate from localStorage
        if (!hasContent(serverState)) {
          const cached = loadCached();
          if (hasContent(cached)) {
            await fetch('/api/graph-state', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action:             'importState',
                customNodes:        cached!.customNodes        ?? [],
                customEdges:        cached!.customEdges        ?? [],
                baselinePositions:  cached!.baselinePositions  ?? {},
                ecosystemPositions: cached!.ecosystemPositions ?? {},
                settings:           cached!.settings,
              }),
            }).catch(() => {});
            const res2 = await fetch('/api/graph-state').catch(() => null);
            const imported: ServerGraphState | null = res2 ? await res2.json().catch(() => null) : null;
            if (imported && mounted) {
              lastPollTs.current = imported.lastUpdated;
              setFullServerStateRaw(imported);
              autosave(imported, autosaveTimer);
            }
          } else {
            if (mounted) setFullServerStateRaw(serverState);
          }
        } else {
          if (mounted) setFullServerStateRaw(serverState);
        }
      }

      if (!mounted) return;

      // Track 3: Try SSE; fall back to polling on error
      if (typeof EventSource !== 'undefined') {
        const es = new EventSource('/api/graph-state/stream');
        sseRef.current = es;

        es.onmessage = (event) => {
          try {
            const { lastUpdated } = JSON.parse(event.data) as { lastUpdated: number; hash: string };
            if (lastUpdated > lastPollTs.current) fetchFull();
          } catch { /* malformed event */ }
        };

        es.onerror = () => {
          es.close();
          sseRef.current = null;
          if (!pollTimer) pollTimer = setInterval(fetchFull, POLL_INTERVAL_MS);
        };
      } else {
        pollTimer = setInterval(fetchFull, POLL_INTERVAL_MS);
      }
    }

    init().catch(() => {});

    return () => {
      mounted = false;
      if (pollTimer) clearInterval(pollTimer);
      sseRef.current?.close();
      sseRef.current = null;
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    };
  }, [fetchFull]);

  return { fullServerState, setFullServerState };
}
