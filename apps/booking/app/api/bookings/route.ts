/**
 * POST /api/bookings — request a booking (→ booking.request_booking).
 *
 * Any church member may request; planner-level isn't required (approval is the
 * gate). The church_id is taken from the verified membership, NOT the body, so
 * the service-role RPC can't be steered at another church. requested_by is the
 * caller's auth user id.
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireMember } from "@/lib/auth-guard";
import { requestBooking } from "@/lib/data/booking";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  const guard = await requireMember();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });
  const { ctx } = guard;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const resourceIds = body.resourceIds;
  const title = body.title;
  const starts = body.starts;
  const ends = body.ends;

  if (!Array.isArray(resourceIds) || resourceIds.length === 0) {
    return NextResponse.json({ error: "resourceIds_required" }, { status: 400 });
  }
  if (typeof title !== "string" || !title.trim()) {
    return NextResponse.json({ error: "title_required" }, { status: 400 });
  }
  if (typeof starts !== "string" || typeof ends !== "string") {
    return NextResponse.json({ error: "starts_ends_required" }, { status: 400 });
  }

  const result = await requestBooking({
    churchId: ctx.churchId,
    resourceIds: resourceIds as string[],
    eventTypeId: typeof body.eventTypeId === "string" ? body.eventTypeId : null,
    title: title.trim(),
    starts,
    ends,
    setupMin: typeof body.setupMin === "number" ? body.setupMin : 0,
    teardownMin: typeof body.teardownMin === "number" ? body.teardownMin : 0,
    requestedBy: ctx.userId,
    renterName: typeof body.renterName === "string" ? body.renterName : null,
    renterContact: typeof body.renterContact === "string" ? body.renterContact : null,
  });

  // request_booking returns {ok:false, conflicts} for slot clashes — surface as
  // 409 so the UI can show alternatives, vs 200 for a successful request.
  const status = result.ok ? 200 : 409;
  return NextResponse.json(result, { status });
}
