// src/hooks/useGraphState.ts
// Owns the server-state polling loop and exposes fullServerState + setter.
// Track 8b

import { useState, useEffect, useRef } from 'react';
import type { ServerGraphState } from '@/lib/serverState';

export function useGraphState() {
  const [fullServerState, setFullServerState] = useState<ServerGraphState | null>(null);
  const lastPollTs = useRef(0);

  useEffect(() => {
    const pull = () =>
      fetch(`/api/graph-state?since=${lastPollTs.current}`)
        .then(r => r.json())
        .then((s: ServerGraphState & { unchanged?: boolean }) => {
          if (s.unchanged) return;
          lastPollTs.current = s.lastUpdated;
          setFullServerState(s);
        }).catch(() => {});

    pull();
    const t = setInterval(pull, 3000);
    return () => clearInterval(t);
  }, []);

  return { fullServerState, setFullServerState };
}
