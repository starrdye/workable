/**
 * GET /api/hermes/stream — Server-Sent Events: a full snapshot as soon as the
 * client connects (so a relaunch or reconnect always starts from fresh data),
 * then a new one whenever Hermes writes to its session stores or boards.
 *
 * Query: same as /api/hermes/snapshot (?home= ?board= ?sample=1).
 */

import { NextRequest } from 'next/server';
import { USE_HERMES } from '@/lib/featureFlags';
import { readSnapshot } from '@/lib/hermes/snapshot';
import { resolveHermesHomes } from '@/lib/hermes/roster';
import { watchHermes } from '@/lib/hermes/watch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Re-send on a timer too, so time-based states (working → interrupted, "2m ago") stay right. */
const REFRESH_MS = 15_000;
const HEARTBEAT_MS = 20_000;

export async function GET(req: NextRequest) {
  if (!USE_HERMES) return new Response('Hermes plugin is off.', { status: 404 });
  const params = req.nextUrl.searchParams;
  const opts = { board: params.get('board'), homeId: params.get('home'), sampleIfEmpty: params.get('sample') === '1' };
  const homes = resolveHermesHomes();
  const home = (homes.find(h => h.id === opts.homeId) ?? homes[0])?.path;

  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      let lastSent = '';
      const send = (event: string, data: string) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`)); } catch { closed = true; }
      };
      const push = (force = false) => {
        try {
          const snap = readSnapshot(opts);
          // generatedAt changes every second; compare the rest to skip no-op sends.
          const body = JSON.stringify(snap);
          const key = JSON.stringify({ ...snap, generatedAt: 0 });
          if (!force && key === lastSent) return;
          lastSent = key;
          send('snapshot', body);
        } catch (err) {
          send('failure', JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
      };

      push(true);
      const unwatch = home ? watchHermes(home, () => push()) : () => {};
      const refresh = setInterval(() => push(true), REFRESH_MS);
      const heartbeat = setInterval(() => { if (!closed) controller.enqueue(encoder.encode(': keep-alive\n\n')); }, HEARTBEAT_MS);

      cleanup = () => {
        if (closed) return;
        closed = true;
        unwatch();
        clearInterval(refresh);
        clearInterval(heartbeat);
        try { controller.close(); } catch { /* already closed */ }
      };
      req.signal.addEventListener('abort', cleanup);
    },
    cancel() { cleanup(); },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' },
  });
}
