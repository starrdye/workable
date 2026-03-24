/**
 * GET /api/graph-state/stream — Server-Sent Events endpoint (Track 3)
 *
 * Pushes a lightweight {lastUpdated, hash} event whenever graph state
 * changes. The client re-fetches full state only on a hash mismatch.
 *
 * Falls back cleanly: if EventSource isn't supported or this route
 * isn't reachable, useGraphState.ts falls back to its 3s poller.
 */

import { getGraphState } from '@/lib/serverState';

export const dynamic = 'force-dynamic';

function hashState(lastUpdated: number, nodeCount: number, edgeCount: number): string {
  return `${lastUpdated}:${nodeCount}:${edgeCount}`;
}

export async function GET() {
  let lastSentHash = '';
  let closed = false;

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      function send(data: string) {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        } catch {
          closed = true;
        }
      }

      // Send initial state immediately
      const initial = getGraphState();
      const initialHash = hashState(
        initial.lastUpdated,
        (initial.customNodes ?? []).length,
        (initial.customEdges ?? []).length,
      );
      lastSentHash = initialHash;
      send(JSON.stringify({ lastUpdated: initial.lastUpdated, hash: initialHash }));

      // Poll every 800ms and emit only on change
      const interval = setInterval(() => {
        if (closed) {
          clearInterval(interval);
          return;
        }
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

      // Cleanup when client disconnects
      return () => {
        closed = true;
        clearInterval(interval);
      };
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection':    'keep-alive',
      'X-Accel-Buffering': 'no', // disable nginx buffering
    },
  });
}
