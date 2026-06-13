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
import { createAdminClient, createBookingAdminClient } from "@/lib/supabase/admin";
import type {
  Booking,
  BookingResource,
  BundleItem,
  EventType,
  MutateBookingResult,
  RequestBookingResult,
  Resource,
  ResourceBundle,
  ResourceAlternatives,
} from "@/src/types/booking";

/**
 * A planned SundayPlan service, read from `public.service` (NOT the booking
 * schema) for the calendar overlay. public.service has no end time, so the
 * caller derives the block from `starts_at_utc` + a default duration.
 */
export interface ServiceBlock {
  id: string;
  name: string;
  starts_at_utc: string;
  state: string;
}

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
 * SundayPlan services overlapping [from, to). Read from `public.service` via the
 * service-role client (NOT the booking schema), church_id-filtered by the
 * caller. public.service has only a start time; the calendar treats each as a
 * read-only block of `defaultDurationMin` so a planner sees the sanctuary is
 * implicitly in use. Excludes archived services.
 */
export async function listServices(
  churchId: string,
  range?: { from?: string; to?: string },
): Promise<ServiceBlock[]> {
  const from = range?.from ?? new Date().toISOString();
  const to =
    range?.to ?? new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();

  // public.service lives in the default (public) schema → plain admin client.
  const db = createAdminClient();
  const { data, error } = await db
    .from("service")
    .select("id, name, starts_at_utc, state")
    .eq("church_id", churchId)
    .neq("state", "archived")
    .gte("starts_at_utc", from)
    .lt("starts_at_utc", to)
    .order("starts_at_utc");
  if (error) throw new Error(`listServices: ${error.message}`);
  return (data ?? []) as ServiceBlock[];
}

/**
 * The resource ids each booking holds, in the visible window. Lets the calendar
 * color/group a booking by its primary resource and lets per-resource filters
 * work. Keyed by booking_id.
 */
export async function listBookingResources(
  bookingIds: string[],
): Promise<Record<string, string[]>> {
  if (bookingIds.length === 0) return {};
  const db = createBookingAdminClient();
  const { data, error } = await db
    .from("booking_resource")
    .select("booking_id, resource_id")
    .in("booking_id", bookingIds);
  if (error) throw new Error(`listBookingResources: ${error.message}`);
  const out: Record<string, string[]> = {};
  for (const row of (data ?? []) as Pick<BookingResource, "booking_id" | "resource_id">[]) {
    (out[row.booking_id] ??= []).push(row.resource_id);
  }
  return out;
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

export interface UpdateEventTypeInput
  extends Partial<Omit<CreateEventTypeInput, "churchId">> {}

/** Update an event type, scoped to the caller's church (church_id in WHERE). */
export async function updateEventType(
  churchId: string,
  eventTypeId: string,
  patch: UpdateEventTypeInput,
): Promise<EventType | null> {
  const fields: Record<string, unknown> = {};
  if (patch.name !== undefined) fields.name = patch.name;
  if (patch.defaultSetupMin !== undefined)
    fields.default_setup_min = patch.defaultSetupMin;
  if (patch.defaultTeardownMin !== undefined)
    fields.default_teardown_min = patch.defaultTeardownMin;
  if (patch.defaultDurationMin !== undefined)
    fields.default_duration_min = patch.defaultDurationMin;
  if (patch.color !== undefined) fields.color = patch.color;
  if (patch.requiresApproval !== undefined)
    fields.requires_approval = patch.requiresApproval;
  if (patch.terms !== undefined) fields.terms = patch.terms;

  const db = createBookingAdminClient();
  const { data, error } = await db
    .from("event_type")
    .update(fields)
    .eq("id", eventTypeId)
    .eq("church_id", churchId)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(`updateEventType: ${error.message}`);
  return (data as EventType | null) ?? null;
}

// ── Resource bundles ──────────────────────────────────────────────────────────

export interface BundleWithItems extends ResourceBundle {
  /** resource ids INCLUDED by the bundle (excludes the primary). */
  item_resource_ids: string[];
}

/** All bundles for the church, each with its included resource ids. */
export async function listBundles(churchId: string): Promise<BundleWithItems[]> {
  const db = createBookingAdminClient();
  const { data: bundles, error } = await db
    .from("resource_bundle")
    .select("*")
    .eq("church_id", churchId)
    .order("name");
  if (error) throw new Error(`listBundles: ${error.message}`);
  const list = (bundles ?? []) as ResourceBundle[];
  if (list.length === 0) return [];

  const { data: items, error: itemErr } = await db
    .from("bundle_item")
    .select("bundle_id, resource_id")
    .in(
      "bundle_id",
      list.map((b) => b.id),
    );
  if (itemErr) throw new Error(`listBundles items: ${itemErr.message}`);

  const byBundle: Record<string, string[]> = {};
  for (const it of (items ?? []) as BundleItem[]) {
    (byBundle[it.bundle_id] ??= []).push(it.resource_id);
  }
  return list.map((b) => ({ ...b, item_resource_ids: byBundle[b.id] ?? [] }));
}

export interface CreateBundleInput {
  churchId: string;
  name: string;
  primaryResourceId: string;
  /** included resource ids (the primary is auto-included for booking). */
  itemResourceIds: string[];
}

/** Create a bundle + its items. Resource ownership enforced by the caller's
 * church_id (the FK + the church_id column keep it tenant-local). */
export async function createBundle(
  input: CreateBundleInput,
): Promise<BundleWithItems> {
  const db = createBookingAdminClient();
  const { data: bundle, error } = await db
    .from("resource_bundle")
    .insert({
      church_id: input.churchId,
      name: input.name,
      primary_resource_id: input.primaryResourceId,
    })
    .select("*")
    .single();
  if (error) throw new Error(`createBundle: ${error.message}`);
  const created = bundle as ResourceBundle;

  const itemIds = input.itemResourceIds.filter(
    (id) => id !== input.primaryResourceId,
  );
  if (itemIds.length > 0) {
    const { error: itemErr } = await db.from("bundle_item").insert(
      itemIds.map((rid) => ({ bundle_id: created.id, resource_id: rid })),
    );
    if (itemErr) throw new Error(`createBundle items: ${itemErr.message}`);
  }
  return { ...created, item_resource_ids: itemIds };
}

/** Delete a bundle (items cascade). church_id-scoped. */
export async function deleteBundle(
  churchId: string,
  bundleId: string,
): Promise<void> {
  const db = createBookingAdminClient();
  const { error } = await db
    .from("resource_bundle")
    .delete()
    .eq("id", bundleId)
    .eq("church_id", churchId);
  if (error) throw new Error(`deleteBundle: ${error.message}`);
}

/**
 * Resolve a bundle to the full set of resource ids to book (primary + items),
 * scoped to the church. Returns null if the bundle isn't found in the church.
 */
export async function resolveBundleResources(
  churchId: string,
  bundleId: string,
): Promise<string[] | null> {
  const db = createBookingAdminClient();
  const { data: bundle, error } = await db
    .from("resource_bundle")
    .select("id, primary_resource_id")
    .eq("id", bundleId)
    .eq("church_id", churchId)
    .maybeSingle();
  if (error) throw new Error(`resolveBundleResources: ${error.message}`);
  if (!bundle) return null;
  const b = bundle as Pick<ResourceBundle, "id" | "primary_resource_id">;

  const { data: items, error: itemErr } = await db
    .from("bundle_item")
    .select("resource_id")
    .eq("bundle_id", b.id);
  if (itemErr) throw new Error(`resolveBundleResources items: ${itemErr.message}`);

  const ids = new Set<string>([b.primary_resource_id]);
  for (const it of (items ?? []) as Pick<BundleItem, "resource_id">[]) {
    ids.add(it.resource_id);
  }
  return [...ids];
}
