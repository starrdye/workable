/**
 * POST /api/hermes/apply — run a previewed plan. Body: { planId }
 * Each plan runs at most once; a stale or expired plan must be previewed again.
 */

import { NextRequest, NextResponse } from 'next/server';
import { USE_HERMES, USE_HERMES_EDIT } from '@/lib/featureFlags';
import { resolveHermesHome } from '@/lib/hermes/roster';
import { takePlan } from '@/lib/hermes/edit/plan';
import { applyPlan } from '@/lib/hermes/edit/apply';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!USE_HERMES || !USE_HERMES_EDIT) {
    return NextResponse.json({ error: 'Editing is off. Set WORKABLE_HERMES_EDIT=true in .env.local and restart.' }, { status: 403 });
  }
  const body = await req.json().catch(() => null) as { planId?: string } | null;
  const plan = body?.planId ? takePlan(body.planId) : null;
  if (!plan) return NextResponse.json({ error: 'This preview has expired or was already applied. Preview the change again.' }, { status: 410 });
  const result = await applyPlan(plan, resolveHermesHome());
  return NextResponse.json(result, { status: result.ok ? 200 : 409 });
}
