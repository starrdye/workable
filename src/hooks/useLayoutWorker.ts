// src/hooks/useLayoutWorker.ts
// React hook that manages a comlink-wrapped layout Web Worker (Track 5c).
// Falls back gracefully to a no-op (server-side layout still works) if the
// Worker fails to initialise (e.g. SSR context or browser restriction).

'use client';

import { useEffect, useRef } from 'react';
import type { Remote } from 'comlink';
import type { LayoutRequest, PositionMap } from '@/workers/layout.worker';

type WorkerApi = {
  computeLayout(req: LayoutRequest): Promise<PositionMap>;
};

export function useLayoutWorker() {
  const apiRef = useRef<Remote<WorkerApi> | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let worker: Worker | null = null;

    (async () => {
      try {
        const { wrap } = await import('comlink');
        worker = new Worker(
          new URL('../workers/layout.worker.ts', import.meta.url),
          { type: 'module' },
        );
        apiRef.current = wrap<WorkerApi>(worker);
      } catch (err) {
        console.warn('[useLayoutWorker] Worker init failed, falling back to server-side layout', err);
      }
    })();

    return () => {
      worker?.terminate();
      apiRef.current = null;
    };
  }, []);

  /**
   * Compute positions off the main thread.
   * Returns null if the worker is unavailable — caller should fall back to
   * server-side `PUT { action: 'resetLayout' }`.
   */
  async function computeLayout(req: LayoutRequest): Promise<PositionMap | null> {
    if (!apiRef.current) return null;
    try {
      return await apiRef.current.computeLayout(req);
    } catch (err) {
      console.warn('[useLayoutWorker] computeLayout failed', err);
      return null;
    }
  }

  return { computeLayout };
}
