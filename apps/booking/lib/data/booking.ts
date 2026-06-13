/**
 * SERVER-ONLY booking data layer. Wraps the `booking` schema RPCs + reads via
 * the service-role client (which bypasses RLS), so callers MUST pass a
 * `churchId` that was resolved from a verified membership (see lib/auth-guard).
 *
 * Writes flow exclusively through the SECURITY DEFINER RPCs in migration 0022;
 * reads are explicitly church_id-filtered here because the service-role client
 * has no RLS gate.
 *
 * SERVER-ONLY: this module reaches for SUPABASE_SERVICE_ROLE_KEY via the admin
 * client — never import it from a client component.
 */
import { createBookingAdminClient } from "@/lib/supabase/admin";
import type {
  Booking,
  EventType,
  MutateBookingResult,
  RequestBookingResult,
  Resource,
  ResourceAlternatives,
} from "@/src/types/booking";

// ── Reads ─────────────────────────────────────────────────────────────────────

export async function listResources(churchId: string): Promise<Resource[]> {
  const db = createBookingAdminClient();
  const { data, error } = await db
    .from("resource")
    .select("*")
    .eq("church_id", churchId)
    .order("name");
  if (error) throw new Error(`listResources: ${error.message}`);
  return (data ?? []) as Resource[];
}

export async function listEventTypes(churchId: string): Promise<EventType[]> {
  const db = createBookingAdminClient();
  const { data, error } = await db
    .from("event_type")
    .select("*")
    .eq("church_id", churchId)
    .order("name");
  if (error) throw new Error(`listEventTypes: ${error.message}`);
  return (data ?? []) as EventType[];
}

/**
 * Bookings whose window overlaps [from, to). Defaults to upcoming (now → +90d).
 * Excludes cancelled/declined by default so callers see the live calendar.
 */
export async function listBookings(
  churchId: string,
  range?: { from?: string; to?: string; includeInactive?: boolean },
): Promise<Booking[]> {
  const from = range?.from ?? new Date().toISOString();
  const to =
    range?.to ?? new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();

  const db = createBookingAdminClient();
  let query = db
    .from("booking")
    .select("*")
    .eq("church_id", churchId)
    // window overlap: starts before `to` AND ends after `from`
    .lt("starts_at_utc", to)
    .gt("ends_at_utc", from)
    .order("starts_at_utc");

  if (!range?.includeInactive) {
    query = query.in("status", ["pending", "approved"]);
  }

  const { data, error } = await query;
  if (error) throw new Error(`listBookings: ${error.message}`);
  return (data ?? []) as Booking[];
}

/**
 * The church_id that owns a booking, or null if it doesn't exist. Used to
 * verify ownership before approve/decline/cancel, since those RPCs don't take a
 * church_id and the service-role client bypasses RLS.
 */
export async function getBookingChurchId(bookingId: string): Promise<string | null> {
  const db = createBookingAdminClient();
  const { data, error } = await db
    .from("booking")
    .select("church_id")
    .eq("id", bookingId)
    .maybeSingle();
  if (error) throw new Error(`getBookingChurchId: ${error.message}`);
  return (data?.church_id as string | undefined) ?? null;
}

// ── Writes (RPCs) ───────────────────────────────────────────────────────────

export interface RequestBookingInput {
  churchId: string;
  resourceIds: string[];
  eventTypeId?: string | null;
  title: string;
  starts: string;
  ends: string;
  setupMin?: number;
  teardownMin?: number;
  /** auth user id of the requester (null for external/public renters). */
  requestedBy?: string | null;
  renterName?: string | null;
  renterContact?: string | null;
}

export async function requestBooking(
  input: RequestBookingInput,
): Promise<RequestBookingResult> {
  const db = createBookingAdminClient();
  const { data, error } = await db.rpc("request_booking", {
    p_church_id: input.churchId,
    p_resource_ids: input.resourceIds,
    p_event_type_id: input.eventTypeId ?? null,
    p_title: input.title,
    p_starts: input.starts,
    p_ends: input.ends,
    p_setup_min: input.setupMin ?? 0,
    p_teardown_min: input.teardownMin ?? 0,
    p_requested_by: input.requestedBy ?? null,
    p_renter_name: input.renterName ?? null,
    p_renter_contact: input.renterContact ?? null,
  });
  if (error) throw new Error(`requestBooking: ${error.message}`);
  return data as RequestBookingResult;
}

export async function approveBooking(
  bookingId: string,
  approverId: string,
): Promise<MutateBookingResult> {
  const db = createBookingAdminClient();
  const { data, error } = await db.rpc("approve_booking", {
    p_booking_id: bookingId,
    p_approver: approverId,
  });
  if (error) throw new Error(`approveBooking: ${error.message}`);
  return data as MutateBookingResult;
}

export async function declineBooking(
  bookingId: string,
  approverId: string,
): Promise<MutateBookingResult> {
  const db = createBookingAdminClient();
  const { data, error } = await db.rpc("decline_booking", {
    p_booking_id: bookingId,
    p_approver: approverId,
  });
  if (error) throw new Error(`declineBooking: ${error.message}`);
  return data as MutateBookingResult;
}

export async function cancelBooking(
  bookingId: string,
  actorId: string,
): Promise<MutateBookingResult> {
  const db = createBookingAdminClient();
  const { data, error } = await db.rpc("cancel_booking", {
    p_booking_id: bookingId,
    p_actor: actorId,
  });
  if (error) throw new Error(`cancelBooking: ${error.message}`);
  return data as MutateBookingResult;
}

export interface SuggestAlternativesInput {
  resourceId: string;
  starts: string;
  ends: string;
  setupMin?: number;
  teardownMin?: number;
  limit?: number;
}

export async function suggestAlternatives(
  input: SuggestAlternativesInput,
): Promise<ResourceAlternatives["windows"]> {
  const db = createBookingAdminClient();
  const { data, error } = await db.rpc("suggest_alternatives", {
    p_resource_id: input.resourceId,
    p_starts: input.starts,
    p_ends: input.ends,
    p_setup_min: input.setupMin ?? 0,
    p_teardown_min: input.teardownMin ?? 0,
    p_limit: input.limit ?? 3,
  });
  if (error) throw new Error(`suggestAlternatives: ${error.message}`);
  return (data ?? []) as ResourceAlternatives["windows"];
}

export async function seedDefaultEventTypes(churchId: string): Promise<void> {
  const db = createBookingAdminClient();
  const { error } = await db.rpc("seed_default_event_types", {
    p_church_id: churchId,
  });
  if (error) throw new Error(`seedDefaultEventTypes: ${error.message}`);
}

// ── Resource / event-type CRUD (service-role; church_id enforced by caller) ───

export interface CreateResourceInput {
  churchId: string;
  kind: Resource["kind"];
  name: string;
  description?: string | null;
  capacity?: number | null;
  site?: string | null;
  color?: string | null;
  defaultSetupMin?: number;
  defaultTeardownMin?: number;
  bookableBy?: Resource["bookable_by"];
  requiresApproval?: boolean;
  memberId?: string | null;
}

export async function createResource(
  input: CreateResourceInput,
): Promise<Resource> {
  const db = createBookingAdminClient();
  const { data, error } = await db
    .from("resource")
    .insert({
      church_id: input.churchId,
      kind: input.kind,
      name: input.name,
      description: input.description ?? null,
      capacity: input.capacity ?? null,
      site: input.site ?? null,
      color: input.color ?? null,
      default_setup_min: input.defaultSetupMin ?? 0,
      default_teardown_min: input.defaultTeardownMin ?? 0,
      bookable_by: input.bookableBy ?? "staff",
      requires_approval: input.requiresApproval ?? true,
      member_id: input.memberId ?? null,
    })
    .select("*")
    .single();
  if (error) throw new Error(`createResource: ${error.message}`);
  return data as Resource;
}

export interface UpdateResourceInput
  extends Partial<Omit<CreateResourceInput, "churchId">> {
  status?: string;
}

/** Update a resource, scoped to the caller's church (church_id guard in WHERE). */
export async function updateResource(
  churchId: string,
  resourceId: string,
  patch: UpdateResourceInput,
): Promise<Resource | null> {
  const fields: Record<string, unknown> = {};
  if (patch.kind !== undefined) fields.kind = patch.kind;
  if (patch.name !== undefined) fields.name = patch.name;
  if (patch.description !== undefined) fields.description = patch.description;
  if (patch.capacity !== undefined) fields.capacity = patch.capacity;
  if (patch.site !== undefined) fields.site = patch.site;
  if (patch.color !== undefined) fields.color = patch.color;
  if (patch.defaultSetupMin !== undefined)
    fields.default_setup_min = patch.defaultSetupMin;
  if (patch.defaultTeardownMin !== undefined)
    fields.default_teardown_min = patch.defaultTeardownMin;
  if (patch.bookableBy !== undefined) fields.bookable_by = patch.bookableBy;
  if (patch.requiresApproval !== undefined)
    fields.requires_approval = patch.requiresApproval;
  if (patch.memberId !== undefined) fields.member_id = patch.memberId;
  if (patch.status !== undefined) fields.status = patch.status;

  const db = createBookingAdminClient();
  const { data, error } = await db
    .from("resource")
    .update(fields)
    .eq("id", resourceId)
    .eq("church_id", churchId)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(`updateResource: ${error.message}`);
  return (data as Resource | null) ?? null;
}

export interface CreateEventTypeInput {
  churchId: string;
  name: string;
  defaultSetupMin?: number;
  defaultTeardownMin?: number;
  defaultDurationMin?: number;
  color?: string | null;
  requiresApproval?: boolean;
  terms?: string | null;
}

export async function createEventType(
  input: CreateEventTypeInput,
): Promise<EventType> {
  const db = createBookingAdminClient();
  const { data, error } = await db
    .from("event_type")
    .insert({
      church_id: input.churchId,
      name: input.name,
      default_setup_min: input.defaultSetupMin ?? 0,
      default_teardown_min: input.defaultTeardownMin ?? 0,
      default_duration_min: input.defaultDurationMin ?? 60,
      color: input.color ?? null,
      requires_approval: input.requiresApproval ?? true,
      terms: input.terms ?? null,
    })
    .select("*")
    .single();
  if (error) throw new Error(`createEventType: ${error.message}`);
  return data as EventType;
}
