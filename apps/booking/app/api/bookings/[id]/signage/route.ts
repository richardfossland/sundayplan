/**
 * POST /api/bookings/:id/signage — toggle a booking's foyer-screen visibility
 * (Phase 4, feature 2). Planner-only; the booking must belong to the planner's
 * own church (the service-role client bypasses RLS, so this is the cross-tenant
 * guard). Body: { showOnSignage: boolean }.
 */
import { NextResponse, type NextRequest } from "next/server";
import { requirePlanner } from "@/lib/auth-guard";
import { setBookingSignage } from "@/lib/data/booking";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const guard = await requirePlanner();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });
  const { ctx } = guard;
  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const show = body.showOnSignage === true;

  // setBookingSignage scopes the UPDATE to the church_id in its WHERE, so a
  // booking from another tenant simply matches nothing → ok:false / not_found.
  const updated = await setBookingSignage(ctx.churchId, id, show);
  if (!updated) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true, showOnSignage: show }, { status: 200 });
}
