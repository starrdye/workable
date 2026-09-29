/**
 * proxy.ts (Next 16 request middleware) — CORS for the Hermes desktop window.
 *
 * Requests from Workable's own pages are same-origin and pass straight
 * through. Requests with `Origin: null` come from a sandboxed frame; they are
 * allowed only with the embed token (WORKABLE_EMBED_TOKEN) and never for the
 * routes that change the Hermes install. Without this check, any website could
 * embed a sandboxed frame and read the local API.
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
  if (req.headers.get('origin') !== 'null') return NextResponse.next();

  if (req.method === 'OPTIONS') return new NextResponse(null, { status: 204, headers: CORS });

  // Fonts are public build assets; the frame fetches them in CORS mode.
  if (req.nextUrl.pathname.startsWith('/_next/static/media/') || req.nextUrl.pathname.startsWith('/__nextjs_font/')) {
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

export const config = { matcher: ['/api/:path*', '/_next/static/media/:path*', '/__nextjs_font/:path*'] };
