/**
 * GET /api/hermes/snapshot — read-only snapshot of the local Hermes team and board.
 *
 * Query: ?board=<slug>  pick a board (defaults to Hermes's current board)
 *        ?sample=1      fill an empty board with labelled example cards
 *        ?home=<id>     which install (from WORKABLE_HERMES_HOMES; default HERMES_HOME)
 */

import { NextRequest, NextResponse } from 'next/server';
import { USE_HERMES } from '@/lib/featureFlags';
import { readSnapshot, HermesNotFoundError } from '@/lib/hermes/snapshot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!USE_HERMES) {
    return NextResponse.json({ error: 'Hermes plugin is off. Set NEXT_PUBLIC_WORKABLE_HERMES=true in .env.local and restart.' }, { status: 404 });
  }
  const params = req.nextUrl.searchParams;
  try {
    const snapshot = readSnapshot({ board: params.get('board'), homeId: params.get('home'), sampleIfEmpty: params.get('sample') === '1' });
    return NextResponse.json(snapshot, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    const status = err instanceof HermesNotFoundError ? 404 : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status });
  }
}
