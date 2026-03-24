/**
 * GET /api/graph-state/stream — Server-Sent Events endpoint (Track 3)
 *
 * Pushes a lightweight {lastUpdated, hash} event whenever graph state
 * changes. The client re-fetches full state only on a hash mismatch.
 *
 * Falls back cleanly: if EventSource isn't supported or this route
 * isn't reachable, useGraphState.ts falls back to its 3s poller.
 *
 * Fix (0.51-personal): ReadableStream.start() return value is ignored by
 * the Streams spec — cleanup must live in cancel(), not in a return value.
 * Also uses request AbortSignal so the interval is cleared the moment the
 * client disconnects, preventing the "enqueue on closed stream" errors that
 * caused the runtime error seen in the dev console.
 */

import { NextRequest } from 'next/server';
import { getGraphState } from '@/lib/serverState';

export const dynamic = 'force-dynamic';

function hashState(lastUpdated: number, nodeCount: number, edgeCount: number): string {
  return `${lastUpdated}:${nodeCount}:${edgeCount}`;
}

export async function GET(request: NextRequest) {
  const encoder = new TextEncoder();
  let lastSentHash = '';
  let interval: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      function send(data: string) {
        try {
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        } catch {
          // Stream already closed — stop the interval
          cleanup();
        }
      }

      function cleanup() {
        if (interval) {
          clearInterval(interval);
          interval = null;
        }
      }

      // Send initial snapshot immediately
      const initial = getGraphState();
      const initialHash = hashState(
        initial.lastUpdated,
        (initial.customNodes ?? []).length,
        (initial.customEdges ?? []).length,
      );
      lastSentHash = initialHash;
      send(JSON.stringify({ lastUpdated: initial.lastUpdated, hash: initialHash }));

      // Poll every 800ms; emit only on state change
      interval = setInterval(() => {
        const state = getGraphState();
        const hash = hashState(
          state.lastUpdated,
          (state.customNodes ?? []).length,
          (state.customEdges ?? []).length,
        );
        if (hash !== lastSentHash) {
          lastSentHash = hash;
          send(JSON.stringify({ lastUpdated: state.lastUpdated, hash }));
        }
      }, 800);

      // AbortSignal fires when the client disconnects or the request is cancelled
      request.signal.addEventListener('abort', () => {
        cleanup();
        try { controller.close(); } catch { /* already closed */ }
      }, { once: true });
    },

    cancel() {
      // Called when the ReadableStream consumer stops reading (e.g. browser navigates away)
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type':      'text/event-stream',
      'Cache-Control':     'no-cache, no-transform',
      'Connection':        'keep-alive',
      'X-Accel-Buffering': 'no', // disable nginx buffering
    },
  });
}
