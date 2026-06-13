/**
 * SERVER-ONLY rental monetization flow (Phase 5). Additive to the Phase 3
 * external-rental request: on a new rental request we
 *   1. FREEZE a rental-agreement snapshot (price/deposit/cancellation/terms from
 *      the resource + event type, AT REQUEST TIME) and persist it + the rendered
 *      Norwegian HTML (pure builder in lib/rental-agreement.ts), and
 *   2. if the resource carries a price, create a DEPOSIT payment intent through
 *      the Vipps seam (StubVippsProvider by default — no network, no keys) and
 *      flip booking.payment_status → 'deposit_pending'.
 *
 * Everything degrades gracefully: with no MAGICLINK_SECRET we skip the return
 * link; with no VIPPS_* creds the stub records the intent; a free resource
 * captures the agreement but creates no payment. Nothing here throws into the
 * request path — failures are logged and swallowed (the booking already exists).
 */
import {
  captureRentalAgreement,
  getChurchName,
  getEventTypeById,
  getResourceById,
  setPaymentStatus,
} from "@/lib/data/booking";
import { renderRentalAgreement, type RentalSnapshot } from "@/lib/rental-agreement";
import {
  createPaymentProvider,
  paymentStatusToBookingStatus,
} from "@/lib/payments";
import { appBaseUrl } from "@/lib/booking-link";

export interface RentalFlowResult {
  /** True if a priced deposit intent was created (stub or real). */
  depositRequested: boolean;
  /** The deposit amount in NOK (0 when free). */
  depositNok: number;
  /** True when the keyless stub provider handled the intent. */
  usedStub: boolean;
  /** Provider redirect URL for the deposit (stub returns a fake one), if any. */
  redirectUrl: string | null;
}

/**
 * Capture the agreement snapshot for a booking and, if priced, kick off the
 * deposit intent. `returnUrl` is where Vipps should send the payer back (the
 * renter's status page). Best-effort: returns a summary; never throws.
 */
export async function startRentalMonetization(opts: {
  bookingId: string;
  churchId: string;
  resourceId: string;
  eventTypeId: string | null;
  renterName: string;
  renterContact: string;
  startsAtUtc: string;
  endsAtUtc: string;
  returnUrl: string | null;
}): Promise<RentalFlowResult> {
  const empty: RentalFlowResult = {
    depositRequested: false,
    depositNok: 0,
    usedStub: false,
    redirectUrl: null,
  };

  const [resource, churchName, eventType] = await Promise.all([
    getResourceById(opts.resourceId),
    getChurchName(opts.churchId),
    opts.eventTypeId ? getEventTypeById(opts.eventTypeId) : Promise.resolve(null),
  ]);
  if (!resource) return empty;

  // Price/terms resolution: the resource wins; the event type is the fallback.
  const priceNok = resource.rental_price_nok ?? eventType?.rental_price_nok ?? null;
  const depositPct = resource.deposit_pct ?? eventType?.deposit_pct ?? null;
  const cancellation =
    resource.cancellation_policy ?? eventType?.cancellation_policy ?? null;
  const terms = eventType?.terms ?? null;

  const snapshot: RentalSnapshot = {
    church: { name: churchName },
    renter: { name: opts.renterName, contact: opts.renterContact },
    resource: { name: resource.name, kind: resource.kind },
    date: { starts_at_utc: opts.startsAtUtc, ends_at_utc: opts.endsAtUtc },
    price_nok: priceNok,
    deposit_pct: depositPct,
    cancellation_policy: cancellation,
    terms,
    captured_at: new Date().toISOString(),
  };

  const { html, depositNok } = renderRentalAgreement(snapshot);

  // Freeze the agreement (snapshot + rendered HTML).
  await captureRentalAgreement({
    bookingId: opts.bookingId,
    churchId: opts.churchId,
    snapshot: snapshot as unknown as Record<string, unknown>,
    html,
  });

  // No price (or zero deposit) → agreement captured, no payment.
  if (!priceNok || priceNok <= 0 || depositNok <= 0) return { ...empty, depositNok };

  // Create the deposit intent through the seam (stub by default).
  const provider = createPaymentProvider(process.env as Record<string, string | undefined>);
  const reference = `booking:${opts.bookingId}:deposit`;
  const returnUrl = opts.returnUrl ?? `${appBaseUrl().replace(/\/+$/, "")}/`;
  const intent = await provider.createPayment({
    amountNok: depositNok,
    reference,
    returnUrl,
    description: `Depositum ${resource.name}`,
  });

  if (intent.ok) {
    await setPaymentStatus({
      bookingId: opts.bookingId,
      churchId: opts.churchId,
      status: paymentStatusToBookingStatus(intent.status, true), // → deposit_pending
      reference: intent.paymentId,
    });
  }

  return {
    depositRequested: intent.ok,
    depositNok,
    usedStub: intent.provider === "stub",
    redirectUrl: intent.ok ? intent.redirectUrl : null,
  };
}
