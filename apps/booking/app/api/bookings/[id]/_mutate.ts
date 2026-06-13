/**
 * Shared handler for the planner-only booking state transitions (approve /
 * decline / cancel). Each verifies planner-level access AND that the target
 * booking belongs to the planner's own church before invoking the RPC — the
 * RPC itself takes no church_id and the service-role client bypasses RLS, so
 * this ownership check is the cross-tenant guard.
 */
import { NextResponse } from "next/server";
import { requirePlanner } from "@/lib/auth-guard";
import {
  getBookingById,
  getBookingChurchId,
  getChurchName,
  listBookingResources,
  listResources,
} from "@/lib/data/booking";
import { sendBookingComms } from "@/lib/comms";
import type { BookingTemplateKey } from "@/lib/booking-templates";
import type { MutateBookingResult } from "@/src/types/booking";

type Mutator = (bookingId: string, actorId: string) => Promise<MutateBookingResult>;

export async function handleBookingMutation(
  params: Promise<{ id: string }>,
  mutate: Mutator,
  /** Template to notify the requester with on success (approve/decline). */
  notifyTemplate?: BookingTemplateKey,
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

  // On a successful transition, notify the requester (best-effort, never blocks
  // the response). Only renters with a contact get a message; comms uses the
  // keyless stub when no provider keys are set.
  if (result.ok && notifyTemplate) {
    void notifyRequester(id, ctx.churchId, notifyTemplate).catch((err) => {
      // eslint-disable-next-line no-console
      console.error("[booking:comms] notify failed", err);
    });
  }

  return NextResponse.json(result, { status });
}

async function notifyRequester(
  bookingId: string,
  churchId: string,
  templateKey: BookingTemplateKey,
): Promise<void> {
  const booking = await getBookingById(bookingId);
  if (!booking || !booking.renter_contact) return; // only external renters are notified here
  const [churchName, resources, brMap] = await Promise.all([
    getChurchName(churchId),
    listResources(churchId),
    listBookingResources([bookingId]),
  ]);
  const primaryId = brMap[bookingId]?.[0];
  const facility = resources.find((r) => r.id === primaryId)?.name ?? booking.title;
  await sendBookingComms({
    templateKey,
    booking,
    churchName,
    facilityName: facility,
    locale: "no",
  });
}
