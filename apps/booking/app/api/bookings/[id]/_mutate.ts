/**
 * Shared handler for the planner-only booking state transitions (approve /
 * decline / cancel). Each verifies planner-level access AND that the target
 * booking belongs to the planner's own church before invoking the RPC — the
 * RPC itself takes no church_id and the service-role client bypasses RLS, so
 * this ownership check is the cross-tenant guard.
 */
import { NextResponse } from "next/server";
import { requirePlanner } from "@/lib/auth-guard";
import { getBookingChurchId } from "@/lib/data/booking";
import type { MutateBookingResult } from "@/src/types/booking";

type Mutator = (bookingId: string, actorId: string) => Promise<MutateBookingResult>;

export async function handleBookingMutation(
  params: Promise<{ id: string }>,
  mutate: Mutator,
): Promise<Response> {
  const guard = await requirePlanner();
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }
  const { ctx } = guard;
  const { id } = await params;

  const ownerChurchId = await getBookingChurchId(id);
  if (!ownerChurchId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (ownerChurchId !== ctx.churchId) {
    // Don't leak existence across tenants — same shape as not_found.
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const result = await mutate(id, ctx.userId);
  const status = result.ok ? 200 : result.conflict ? 409 : 400;
  return NextResponse.json(result, { status });
}
