/**
 * useHermesSnapshot — polls /api/hermes/snapshot while the tab is visible.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { HermesSnapshot } from '@/lib/hermes/types';

export const HERMES_POLL_MS = 2500;

export interface HermesSnapshotState {
  snapshot: HermesSnapshot | null;
  error: string | null;
  loading: boolean;
  /** Date.now() of the last successful fetch. */
  lastFetched: number | null;
  refresh: () => void;
}

export function useHermesSnapshot(board: string | null, sample: boolean, paused = false): HermesSnapshotState {
  const [snapshot, setSnapshot] = useState<HermesSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastFetched, setLastFetched] = useState<number | null>(null);
  const inFlight = useRef(false);

  const fetchOnce = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const qs = new URLSearchParams();
      if (board) qs.set('board', board);
      if (sample) qs.set('sample', '1');
      const res = await fetch(`/api/hermes/snapshot?${qs}`, { cache: 'no-store' });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
      setSnapshot(body as HermesSnapshot);
      setError(null);
      setLastFetched(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [board, sample]);

  useEffect(() => {
    fetchOnce();
    if (paused) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') fetchOnce();
    }, HERMES_POLL_MS);
    return () => window.clearInterval(id);
  }, [fetchOnce, paused]);

  return { snapshot, error, loading, lastFetched, refresh: fetchOnce };
}
