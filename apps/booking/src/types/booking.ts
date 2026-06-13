/**
 * TypeScript shapes for the `booking` schema (migration 0022). These mirror the
 * table columns one-for-one; timestamps are ISO-8601 strings as PostgREST
 * returns them.
 */

export type ResourceKind = "room" | "equipment" | "person" | "vehicle";
export type BookableBy = "staff" | "members" | "public";
export type BookingStatus = "pending" | "approved" | "declined" | "cancelled";
export type PaymentStatus =
  | "none"
  | "deposit_pending"
  | "deposit_paid"
  | "paid"
  | "refunded";

export interface Resource {
  id: string;
  church_id: string;
  kind: ResourceKind;
  name: string;
  description: string | null;
  capacity: number | null;
  site: string | null;
  color: string | null;
  default_setup_min: number;
  default_teardown_min: number;
  bookable_by: BookableBy;
  requires_approval: boolean;
  member_id: string | null;
  status: string;
  /** Rental monetization (migration 0024). */
  rental_price_nok: number | null;
  deposit_pct: number | null;
  cancellation_policy: string | null;
  created_at: string;
  updated_at: string;
}

export interface EventType {
  id: string;
  church_id: string;
  name: string;
  default_setup_min: number;
  default_teardown_min: number;
  default_duration_min: number;
  color: string | null;
  requires_approval: boolean;
  terms: string | null;
  /** Rental monetization (migration 0024). */
  rental_price_nok: number | null;
  deposit_pct: number | null;
  cancellation_policy: string | null;
  created_at: string;
  updated_at: string;
}

export interface Booking {
  id: string;
  church_id: string;
  event_type_id: string | null;
  requested_by: string | null;
  title: string;
  purpose: string | null;
  starts_at_utc: string;
  ends_at_utc: string;
  setup_min: number;
  teardown_min: number;
  status: BookingStatus;
  approved_by: string | null;
  service_id: string | null;
  series_id: string | null;
  renter_name: string | null;
  renter_contact: string | null;
  show_on_signage: boolean;
  notes: string | null;
  /** Rental payment lifecycle (migration 0024). */
  payment_status: PaymentStatus;
  payment_reference: string | null;
  created_at: string;
  updated_at: string;
}

/** A frozen rental agreement (booking.rental_agreement, migration 0024). */
export interface RentalAgreementRow {
  id: string;
  booking_id: string;
  church_id: string;
  snapshot: Record<string, unknown>;
  agreement_html: string;
  accepted_at: string | null;
  accepted_token_jti: string | null;
  created_at: string;
  updated_at: string;
}

export interface BookingResource {
  booking_id: string;
  resource_id: string;
  /** tstzrange serialized by PostgREST, e.g. `["2026-06-13T10:00+00","..."]`. */
  blocked_range: string;
  status: string;
}

export interface ResourceBundle {
  id: string;
  church_id: string;
  name: string;
  primary_resource_id: string;
  created_at: string;
  updated_at: string;
}

export interface BundleItem {
  bundle_id: string;
  resource_id: string;
}

/**
 * A recurring weekly bookable window for a `person` resource (appointment /
 * samtale booking). weekday: 0=Sunday … 6=Saturday (matches the SQL check +
 * JS Date.getUTCDay()). Times are wall-clock `HH:MM[:SS]` strings.
 */
export interface Availability {
  id: string;
  resource_id: string;
  weekday: number;
  start_time: string;
  end_time: string;
}

// ── RPC result shapes ────────────────────────────────────────────────────────

export interface ConflictWindow {
  starts: string;
  ends: string;
}

export interface ResourceConflict {
  resource_id: string;
  conflicts: { booking_id: string; range: ConflictWindow }[];
}

export interface ResourceAlternatives {
  resource_id: string;
  windows: ConflictWindow[];
}

/** Return shape of `booking.request_booking`. */
export type RequestBookingResult =
  | { ok: true; booking_id: string; status: BookingStatus }
  | { ok: false; conflict: true }
  | {
      ok: false;
      conflicts: ResourceConflict[];
      alternatives: ResourceAlternatives[];
    };

/** Return shape of approve/decline/cancel. */
export type MutateBookingResult =
  | { ok: true; booking_id: string; status: BookingStatus }
  | { ok: false; conflict?: true; error?: string };
