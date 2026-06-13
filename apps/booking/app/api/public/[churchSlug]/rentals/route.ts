/**
 * POST /api/public/:churchSlug/rentals — external (no-account) rental request.
 *
 * PUBLIC, unauthenticated, rate-limit-friendly. The church_id is resolved
 * SERVER-SIDE from the URL slug (never trusted from the body). Only resources
 * that are bookable_by='public' AND belong to that church can be requested — a
 * body that smuggles a members/staff resource id is rejected. The renter
 * supplies name + contact + (optional) event type; we create a PENDING booking
 * (the RPC still decides pending vs approved per requires_approval) and mint a
 * `booking_status` magic link so the renter can track/cancel it at /r/<token>.
 *
 * No PII is echoed back beyond what the renter typed; the response carries only
 * the minted token (+ status), which the renter is the one holding.
 */
import { NextResponse, type NextRequest } from "next/server";
import {
  getBookingById,
  getChurchName,
  listPublicResources,
  requestBooking,
} from "@/lib/data/booking";
import { hasMagicLinkSecret, mintBookingStatusToken } from "@/lib/booking-link";
import { notifyPlannersOfRequest, sendBookingComms } from "@/lib/comms";
import { startRentalMonetization } from "@/lib/rental-flow";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ churchSlug: string }> },
): Promise<Response> {
  const { churchSlug } = await params;

  // Resolve church + its public resources up front; both reject unknown slugs.
  const publicResources = await listPublicResourcesBySlug(churchSlug);
  if (!publicResources) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const { churchId, resources } = publicResources;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const resourceId = body.resourceId;
  const renterName = typeof body.renterName === "string" ? body.renterName.trim() : "";
  const renterContact = typeof body.renterContact === "string" ? body.renterContact.trim() : "";
  const starts = body.starts;
  const ends = body.ends;
  const purpose = typeof body.purpose === "string" ? body.purpose.trim() : "";

  if (typeof resourceId !== "string") {
    return NextResponse.json({ error: "resource_required" }, { status: 400 });
  }
  // Whitelist: the resource MUST be one of this church's public resources.
  const resource = resources.find((r) => r.id === resourceId);
  if (!resource) {
    return NextResponse.json({ error: "resource_not_bookable" }, { status: 403 });
  }
  if (!renterName) {
    return NextResponse.json({ error: "name_required" }, { status: 400 });
  }
  if (!renterContact) {
    return NextResponse.json({ error: "contact_required" }, { status: 400 });
  }
  if (typeof starts !== "string" || typeof ends !== "string") {
    return NextResponse.json({ error: "starts_ends_required" }, { status: 400 });
  }

  const title = purpose ? `${purpose} — ${renterName}` : `${resource.name} — ${renterName}`;

  const result = await requestBooking({
    churchId,
    resourceIds: [resourceId],
    eventTypeId: typeof body.eventTypeId === "string" ? body.eventTypeId : null,
    title,
    starts,
    ends,
    setupMin: resource.default_setup_min,
    teardownMin: resource.default_teardown_min,
    requestedBy: null, // external renter has no auth user
    renterName,
    renterContact,
  });

  if (!result.ok) {
    // Slot clash → 409 with conflicts/alternatives (same shape the form reads).
    return NextResponse.json(result, { status: 409 });
  }

  // Mint the renter's status link. If the secret isn't configured we still
  // succeed (the booking exists) but flag that no link could be issued.
  let token: string | null = null;
  let statusUrl: string | null = null;
  if (hasMagicLinkSecret()) {
    token = await mintBookingStatusToken(result.booking_id, churchId);
    statusUrl = `/r/${encodeURIComponent(token)}`;
  }

  // Rental monetization (Phase 5): freeze the agreement snapshot + (if priced)
  // create the deposit intent through the Vipps seam (stub by default). The
  // renter's status page is the payment return URL. Best-effort: never blocks
  // the response. A priced resource flips payment_status → deposit_pending.
  const origin = new URL(req.url).origin;
  const returnUrl = statusUrl ? `${origin}${statusUrl}` : null;
  void startRentalMonetization({
    bookingId: result.booking_id,
    churchId,
    resourceId,
    eventTypeId: typeof body.eventTypeId === "string" ? body.eventTypeId : null,
    renterName,
    renterContact,
    startsAtUtc: starts,
    endsAtUtc: ends,
    returnUrl,
  }).catch((err) => {
    // eslint-disable-next-line no-console
    console.error("[booking:rental] monetization failed", err);
  });

  // Comms (best-effort): confirm to the renter + notify planners on pending.
  void fireRentalComms(churchId, result.booking_id, resource.name, result.status).catch(
    (err) => {
      // eslint-disable-next-line no-console
      console.error("[booking:comms] rental notify failed", err);
    },
  );

  return NextResponse.json(
    {
      ok: true,
      status: result.status,
      token,
      statusUrl,
      // FLAG when no link could be minted (deploy needs MAGICLINK_SECRET).
      linkIssued: token !== null,
    },
    { status: 200 },
  );
}

/** Resolve a slug to its church_id + the public resources, or null. */
async function listPublicResourcesBySlug(slug: string) {
  const { resolveChurchBySlug } = await import("@/lib/data/booking");
  const church = await resolveChurchBySlug(slug);
  if (!church) return null;
  const resources = await listPublicResources(church.id);
  return { churchId: church.id, resources };
}

async function fireRentalComms(
  churchId: string,
  bookingId: string,
  facility: string,
  status: string,
): Promise<void> {
  const [booking, churchName] = await Promise.all([
    getBookingById(bookingId),
    getChurchName(churchId),
  ]);
  if (!booking) return;
  const isPending = status === "pending";
  if (isPending) {
    await notifyPlannersOfRequest({ booking, churchName, facilityName: facility, locale: "no" });
  }
  await sendBookingComms({
    templateKey: isPending ? "booking_requested" : "booking_approved",
    booking,
    churchName,
    facilityName: facility,
    locale: "no",
  });
}

/** GET — list this church's public resources + a help message (anon-safe). */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ churchSlug: string }> },
): Promise<Response> {
  const { churchSlug } = await params;
  const resolved = await listPublicResourcesBySlug(churchSlug);
  if (!resolved) return NextResponse.json({ error: "not_found" }, { status: 404 });
  // Only non-sensitive fields leak to anon callers.
  const resources = resolved.resources.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    description: r.description,
    capacity: r.capacity,
    site: r.site,
    requires_approval: r.requires_approval,
    default_setup_min: r.default_setup_min,
    default_teardown_min: r.default_teardown_min,
  }));
  return NextResponse.json({ resources });
}
