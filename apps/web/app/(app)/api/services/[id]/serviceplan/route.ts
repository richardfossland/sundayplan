/**
 * GET /api/services/:id/serviceplan — the canonical ServicePlan export.
 *
 * Returns the cross-app {@link ServicePlan} (SundayStage setlist rendering,
 * SundayRec metadata linking) for one service, assembled from Supabase under the
 * caller's RLS. 404s when the service isn't found / visible. The fetch +
 * assembly live in the SDK; this handler is the thin HTTP edge.
 */
import { NextResponse } from "next/server";
import { getServicePlan } from "@/lib/data/serviceplan";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getServicePlan(id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }
  return NextResponse.json(result.plan);
}
