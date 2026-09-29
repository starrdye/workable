/**
 * GET /api/graphs/:id — a graph the MCP tools stored (generate_workflow /
 * patch_workflow), for the chat card and the embed page. Read-only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { USE_HERMES } from '@/lib/featureFlags';
import { createFileGraphStore } from '@/lib/mcp/graphStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!USE_HERMES) return NextResponse.json({ error: 'Hermes plugin is off.' }, { status: 404 });
  const { id } = await params;
  const graph = createFileGraphStore().get(id);
  if (!graph) return NextResponse.json({ error: `No workflow with id ${id}.` }, { status: 404 });
  return NextResponse.json(graph, { headers: { 'Cache-Control': 'no-store' } });
}
