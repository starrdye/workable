/**
 * GET /api/hermes/summary — the team at a glance, for the Hermes status-bar
 * chip and floating card: one worded status per agent plus a headline.
 * Same statuses as the team view (src/lib/hermes/status.ts). Read-only.
 *
 * Query: ?home=<id>  which install (default HERMES_HOME)
 */

import { NextRequest, NextResponse } from 'next/server';
import { USE_HERMES } from '@/lib/featureFlags';
import { readSnapshot, HermesNotFoundError } from '@/lib/hermes/snapshot';
import { teamSummary } from '@/lib/hermes/status';
import { translations, type TranslationKey } from '@/lib/i18n';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const en = (key: string) => translations.en[key as TranslationKey] ?? key;

export async function GET(req: NextRequest) {
  if (!USE_HERMES) {
    return NextResponse.json({ error: 'Hermes plugin is off. Set NEXT_PUBLIC_WORKABLE_HERMES=true in .env.local and restart.' }, { status: 404 });
  }
  try {
    const snapshot = readSnapshot({ board: null, homeId: req.nextUrl.searchParams.get('home'), sampleIfEmpty: false });
    return NextResponse.json(teamSummary(snapshot, en), { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    const status = err instanceof HermesNotFoundError ? 404 : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status });
  }
}
