/**
 * useHermesSnapshot — live Hermes data for the /hermes view.
 *
 * Subscribes to /api/hermes/stream (Server-Sent Events): the server sends a
 * full snapshot on every (re)connect and whenever Hermes writes, so sending a
 * message shows up within a fraction of a second. While the stream is down it
 * falls back to polling, and it refetches whenever the tab becomes visible or
 * the network comes back.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { HermesSnapshot } from '@/lib/hermes/types';
import { withEmbedToken } from '@/lib/embed';

/** Polling interval while the live stream is unavailable. */
export const HERMES_POLL_MS = 5000;

export type HermesConnection = 'connecting' | 'live' | 'polling';

export interface HermesSnapshotState {
  snapshot: HermesSnapshot | null;
  error: string | null;
  loading: boolean;
  /** Date.now() of the last snapshot received. */
  lastFetched: number | null;
  connection: HermesConnection;
  refresh: () => void;
}

export function useHermesSnapshot(board: string | null, sample: boolean, paused = false, home: string | null = null): HermesSnapshotState {
  const [snapshot, setSnapshot] = useState<HermesSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastFetched, setLastFetched] = useState<number | null>(null);
  const [connection, setConnection] = useState<HermesConnection>('connecting');
  const inFlight = useRef(false);

  const query = useCallback(() => {
    const qs = new URLSearchParams();
    if (home) qs.set('home', home);
    if (board) qs.set('board', board);
    if (sample) qs.set('sample', '1');
    return qs.toString();
  }, [board, sample, home]);

  const accept = useCallback((snap: HermesSnapshot) => {
    setSnapshot(snap);
    setError(null);
    setLastFetched(Date.now());
    setLoading(false);
  }, []);

  const fetchOnce = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await fetch(`/api/hermes/snapshot?${query()}`, { cache: 'no-store' });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
      accept(body as HermesSnapshot);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    } finally {
      inFlight.current = false;
    }
  }, [query, accept]);

  useEffect(() => {
    if (paused) { fetchOnce(); return; }
    let poll: number | null = null;
    const startPolling = () => {
      if (poll == null) poll = window.setInterval(() => { if (document.visibilityState === 'visible') fetchOnce(); }, HERMES_POLL_MS);
    };
    const stopPolling = () => { if (poll != null) { window.clearInterval(poll); poll = null; } };

    let es: EventSource | null = null;
    if (typeof EventSource !== 'undefined') {
      setConnection('connecting');
      es = new EventSource(withEmbedToken(`/api/hermes/stream?${query()}`));
      es.addEventListener('snapshot', ev => {
        try { accept(JSON.parse((ev as MessageEvent).data) as HermesSnapshot); } catch { /* malformed frame */ }
      });
      es.addEventListener('failure', ev => {
        try { setError(JSON.parse((ev as MessageEvent).data).error); } catch { /* ignore */ }
        setLoading(false);
      });
      // The server sends a full snapshot on every (re)connect, so reopening == re-query everything.
      es.onopen = () => { setConnection('live'); stopPolling(); };
      es.onerror = () => { setConnection('polling'); startPolling(); }; // EventSource retries on its own
    } else {
      setConnection('polling');
      fetchOnce();
      startPolling();
    }

    const refetch = () => { if (document.visibilityState === 'visible') fetchOnce(); };
    document.addEventListener('visibilitychange', refetch);
    window.addEventListener('online', refetch);
    window.addEventListener('focus', refetch);
    return () => {
      es?.close();
      stopPolling();
      document.removeEventListener('visibilitychange', refetch);
      window.removeEventListener('online', refetch);
      window.removeEventListener('focus', refetch);
    };
  }, [paused, query, accept, fetchOnce]);

  return { snapshot, error, loading, lastFetched, connection, refresh: fetchOnce };
}
