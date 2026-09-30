/**
 * proxy.ts (Next 16 request middleware) — CORS for the Hermes desktop window.
 *
 * Requests from Workable's own pages are same-origin and pass straight
 * through. Requests with `Origin: null` come from a sandboxed frame: pages and
 * fonts get CORS headers, while /api calls need the embed token
 * (WORKABLE_EMBED_TOKEN) and never reach the routes that change Hermes. Without this check, any website could
 * embed a sandboxed frame and read the local API.
 *
 * The Hermes plugin's status-bar chip calls /api/hermes/summary from the
 * Hermes window itself, whose origin isn't "null". Any cross-origin /api
 * request that carries the embed token gets the same treatment.
 */

import { NextRequest, NextResponse } from 'next/server';

const EDIT_ROUTES = ['/api/hermes/plan', '/api/hermes/apply'];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '600',
};

export function proxy(req: NextRequest) {
  const origin = req.headers.get('origin');
  const isApi = req.nextUrl.pathname.startsWith('/api/');
  const hasToken = req.nextUrl.searchParams.has('embed');
  if (origin !== 'null' && !(origin && isApi && hasToken)) return NextResponse.next();

  if (req.method === 'OPTIONS') return new NextResponse(null, { status: 204, headers: CORS });

  // Pages, their RSC payloads (client navigation) and fonts carry no private
  // data — that only comes from /api — so the frame may fetch them in CORS mode.
  if (!isApi) {
    const res = NextResponse.next();
    res.headers.set('Access-Control-Allow-Origin', '*');
    return res;
  }

  const expected = process.env.WORKABLE_EMBED_TOKEN?.trim();
  if (!expected || req.nextUrl.searchParams.get('embed') !== expected) {
    return NextResponse.json({ error: 'Embedded requests need a valid embed token.' }, { status: 403 });
  }
  if (EDIT_ROUTES.some(r => req.nextUrl.pathname.startsWith(r))) {
    return NextResponse.json({ error: 'Open Workable in the browser to change Hermes.' }, { status: 403, headers: CORS });
  }

  const res = NextResponse.next();
  res.headers.set('Access-Control-Allow-Origin', '*');
  return res;
}

// Everything except JS/CSS chunks (loaded as plain <script>/<link>, no CORS needed).
export const config = { matcher: ['/((?!_next/static/chunks|_next/static/css).*)'] };
