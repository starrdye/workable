/**
 * POST /api/hermes/plan — preview a change to the Hermes install. Writes nothing.
 * Body: { op: 'add-agent' | 'edit-agent' | 'add-project', input: {...} }
 */

import { NextRequest, NextResponse } from 'next/server';
import { USE_HERMES, USE_HERMES_EDIT } from '@/lib/featureFlags';
import { resolveHermesHome } from '@/lib/hermes/roster';
import { PlanError, planAddAgent, planAddProject, planEditAgent, toPlanView } from '@/lib/hermes/edit/plan';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!USE_HERMES || !USE_HERMES_EDIT) {
    return NextResponse.json({ error: 'Editing is off. Set WORKABLE_HERMES_EDIT=true in .env.local and restart.' }, { status: 403 });
  }
  const body = await req.json().catch(() => null) as { op?: string; input?: Record<string, unknown> } | null;
  const home = resolveHermesHome();
  try {
    const input = (body?.input ?? {}) as never;
    const plan = body?.op === 'add-agent' ? planAddAgent(home, input)
      : body?.op === 'edit-agent' ? planEditAgent(home, input)
      : body?.op === 'add-project' ? planAddProject(home, input)
      : null;
    if (!plan) return NextResponse.json({ error: 'Unknown change type.' }, { status: 400 });
    return NextResponse.json(toPlanView(plan));
  } catch (err) {
    const status = err instanceof PlanError ? 400 : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status });
  }
}
