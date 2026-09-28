/**
 * GET /api/hermes/task/:id — one card's full event and run history, for Replay mode.
 */

import { NextRequest, NextResponse } from 'next/server';
import { USE_HERMES } from '@/lib/featureFlags';
import { readTaskDetail } from '@/lib/hermes/snapshot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!USE_HERMES) return NextResponse.json({ error: 'Hermes plugin is off.' }, { status: 404 });
  const { id } = await params;
  try {
    const detail = readTaskDetail(id, { board: req.nextUrl.searchParams.get('board') });
    if (!detail) return NextResponse.json({ error: `Card ${id} not found on this board.` }, { status: 404 });
    return NextResponse.json(detail, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
