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
import { freeSlots as deriveFreeSlots, type FreeSlot } from "@/lib/slots";
import type {
  Availability,
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

// ── Single-booking read + member's own requests ───────────────────────────────

/** A single booking by id, or null. NOT church-scoped — callers must check. */
export async function getBookingById(bookingId: string): Promise<Booking | null> {
  const db = createBookingAdminClient();
  const { data, error } = await db
    .from("booking")
    .select("*")
    .eq("id", bookingId)
    .maybeSingle();
  if (error) throw new Error(`getBookingById: ${error.message}`);
  return (data as Booking | null) ?? null;
}

/**
 * The bookings a given auth user requested (their own request history + status).
 * church_id-scoped to the caller's verified membership.
 */
export async function listMyRequests(
  churchId: string,
  userId: string,
): Promise<Booking[]> {
  const db = createBookingAdminClient();
  const { data, error } = await db
    .from("booking")
    .select("*")
    .eq("church_id", churchId)
    .eq("requested_by", userId)
    .order("starts_at_utc", { ascending: false })
    .limit(100);
  if (error) throw new Error(`listMyRequests: ${error.message}`);
  return (data ?? []) as Booking[];
}

/** Resources of a church a MEMBER may book (bookable_by in members/public). */
export async function listMemberBookableResources(
  churchId: string,
): Promise<Resource[]> {
  const db = createBookingAdminClient();
  const { data, error } = await db
    .from("resource")
    .select("*")
    .eq("church_id", churchId)
    .eq("status", "active")
    .in("bookable_by", ["members", "public"])
    .order("name");
  if (error) throw new Error(`listMemberBookableResources: ${error.message}`);
  return (data ?? []) as Resource[];
}

// ── Public (no-account) reads, resolved from a verified church slug ────────────

export interface PublicChurch {
  id: string;
  name: string;
  slug: string;
  locale: string;
}

/**
 * Resolve a church by its public slug. The ONLY trusted source of church_id on
 * the public rental path — the slug comes from the URL, we look up the row
 * server-side, and every downstream read/write uses the resolved id (never a
 * client-supplied church_id).
 */
export async function resolveChurchBySlug(slug: string): Promise<PublicChurch | null> {
  if (!/^[a-z0-9-]+$/.test(slug)) return null;
  const db = createAdminClient();
  const { data, error } = await db
    .from("church")
    .select("id, name, slug, locale")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw new Error(`resolveChurchBySlug: ${error.message}`);
  return (data as PublicChurch | null) ?? null;
}

/** Church display name by id (for comms / status pages). */
export async function getChurchName(churchId: string): Promise<string> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("church")
    .select("name")
    .eq("id", churchId)
    .maybeSingle();
  if (error) throw new Error(`getChurchName: ${error.message}`);
  return (data?.name as string | undefined) ?? "";
}

/**
 * Publicly-bookable resources for a church (bookable_by='public' only). Safe to
 * expose to anonymous renters — no member-only resources leak.
 */
export async function listPublicResources(churchId: string): Promise<Resource[]> {
  const db = createBookingAdminClient();
  const { data, error } = await db
    .from("resource")
    .select("*")
    .eq("church_id", churchId)
    .eq("status", "active")
    .eq("bookable_by", "public")
    .order("name");
  if (error) throw new Error(`listPublicResources: ${error.message}`);
  return (data ?? []) as Resource[];
}

/** Event types for a church (used for the public rental purpose picker + terms). */
export async function listEventTypesPublic(churchId: string): Promise<EventType[]> {
  return listEventTypes(churchId);
}

// ── Availability (person/appointment windows) ──────────────────────────────────

/** Availability windows for one resource, ordered weekday then start. */
export async function listAvailability(
  resourceId: string,
): Promise<Availability[]> {
  const db = createBookingAdminClient();
  const { data, error } = await db
    .from("availability")
    .select("*")
    .eq("resource_id", resourceId)
    .order("weekday")
    .order("start_time");
  if (error) throw new Error(`listAvailability: ${error.message}`);
  return (data ?? []) as Availability[];
}

/** Verify a resource belongs to the church (guards availability CRUD). */
export async function resourceBelongsToChurch(
  churchId: string,
  resourceId: string,
): Promise<boolean> {
  const db = createBookingAdminClient();
  const { data, error } = await db
    .from("resource")
    .select("id")
    .eq("id", resourceId)
    .eq("church_id", churchId)
    .maybeSingle();
  if (error) throw new Error(`resourceBelongsToChurch: ${error.message}`);
  return Boolean(data);
}

export async function createAvailability(input: {
  resourceId: string;
  weekday: number;
  startTime: string;
  endTime: string;
}): Promise<Availability> {
  const db = createBookingAdminClient();
  const { data, error } = await db
    .from("availability")
    .insert({
      resource_id: input.resourceId,
      weekday: input.weekday,
      start_time: input.startTime,
      end_time: input.endTime,
    })
    .select("*")
    .single();
  if (error) throw new Error(`createAvailability: ${error.message}`);
  return data as Availability;
}

/** Delete an availability row, but only if its resource is in the church. */
export async function deleteAvailability(
  churchId: string,
  availabilityId: string,
): Promise<boolean> {
  const db = createBookingAdminClient();
  // Confirm ownership through the parent resource before deleting.
  const { data: row, error: readErr } = await db
    .from("availability")
    .select("id, resource_id")
    .eq("id", availabilityId)
    .maybeSingle();
  if (readErr) throw new Error(`deleteAvailability read: ${readErr.message}`);
  if (!row) return false;
  if (!(await resourceBelongsToChurch(churchId, row.resource_id as string))) {
    return false;
  }
  const { error } = await db.from("availability").delete().eq("id", availabilityId);
  if (error) throw new Error(`deleteAvailability: ${error.message}`);
  return true;
}

/**
 * Server-side free-slot derivation for a `person` resource: read its weekly
 * availability + approved holds in [from, to), then derive slots via the pure
 * `freeSlots` core. church_id-scoped via the resource ownership check upstream.
 */
export async function computeFreeSlots(input: {
  resourceId: string;
  from: string;
  to: string;
  slotMinutes: number;
  now?: string;
}): Promise<FreeSlot[]> {
  const db = createBookingAdminClient();
  const [windows, holds] = await Promise.all([
    listAvailability(input.resourceId),
    db
      .from("booking_resource")
      .select("blocked_range, status")
      .eq("resource_id", input.resourceId)
      .eq("status", "approved"),
  ]);
  if (holds.error) throw new Error(`computeFreeSlots: ${holds.error.message}`);

  const busy = (holds.data ?? [])
    .map((r) => parseTstzRange((r as { blocked_range: string }).blocked_range))
    .filter((r): r is { startMs: number; endMs: number } => r !== null);

  return deriveFreeSlots({
    windows: windows.map((w) => ({
      weekday: w.weekday,
      start_time: w.start_time,
      end_time: w.end_time,
    })),
    busy,
    slotMinutes: input.slotMinutes,
    fromMs: Date.parse(input.from),
    toMs: Date.parse(input.to),
    nowMs: input.now ? Date.parse(input.now) : Date.now(),
  });
}

/**
 * Parse a PostgREST-serialized tstzrange like `["2026-06-13 10:00:00+00",...)`
 * into {startMs,endMs}. Tolerates `[`/`(` and `]`/`)` bounds and quoted parts.
 */
export function parseTstzRange(
  raw: string,
): { startMs: number; endMs: number } | null {
  if (!raw) return null;
  const inner = raw.slice(1, -1); // strip bounds
  const parts = inner.split(",");
  if (parts.length !== 2) return null;
  const clean = (s: string) =>
    s
      .trim()
      .replace(/^"|"$/g, "")
      .replace(" ", "T")
      // Postgres serializes the UTC offset as `+00`; normalize to `+00:00`.
      .replace(/([+-]\d{2})$/, "$1:00");
  const startMs = Date.parse(clean(parts[0]));
  const endMs = Date.parse(clean(parts[1]));
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return null;
  return { startMs, endMs };
}

// ── Reminder seam (compute-only; wiring to a scheduler is deferred) ────────────

export interface BookingReminderTarget {
  booking_id: string;
  church_id: string;
  title: string;
  starts_at_utc: string;
  renter_contact: string | null;
  /** Whole days from `now` to the booking start. */
  days_until: number;
}

/**
 * Pure: given approved bookings + a "now", return those whose start falls on a
 * reminder day (default: the day before). No DB, no send — a scheduler/cron
 * would call this then hand the targets to sendBookingComms. Mirrors the SDK's
 * cadence idea (dueMessages) but for a single per-booking reminder window.
 */
export function dueBookingReminders(
  bookings: Pick<
    Booking,
    "id" | "church_id" | "title" | "starts_at_utc" | "renter_contact" | "status"
  >[],
  now: Date,
  reminderDaysBefore: number[] = [1],
): BookingReminderTarget[] {
  const MS_PER_DAY = 86_400_000;
  const want = new Set(reminderDaysBefore);
  const out: BookingReminderTarget[] = [];
  for (const b of bookings) {
    if (b.status !== "approved") continue;
    const daysUntil = Math.floor((Date.parse(b.starts_at_utc) - now.getTime()) / MS_PER_DAY);
    if (daysUntil < 0 || !want.has(daysUntil)) continue;
    out.push({
      booking_id: b.id,
      church_id: b.church_id,
      title: b.title,
      starts_at_utc: b.starts_at_utc,
      renter_contact: b.renter_contact,
      days_until: daysUntil,
    });
  }
  return out;
}

// ── Utilization dashboard (Phase 4) ─────────────────────────────────────────

export interface UtilizationRow {
  booking_id: string;
  resource_id: string;
  start_ms: number;
  end_ms: number;
  is_external: boolean;
  status: string;
}

/**
 * Approved booking_resource holds for a church in [from,to), flattened to
 * util-block rows (effective range parsed from the stored tstzrange, so the
 * dashboard's occupancy reflects the same buffered hold the calendar shows).
 * `is_external` = the parent booking has a renter_name (no auth requester).
 */
export async function listUtilizationBlocks(
  churchId: string,
  range: { from: string; to: string },
): Promise<UtilizationRow[]> {
  const db = createBookingAdminClient();
  // Approved bookings in window, with their renter flag.
  const { data: bookings, error: bErr } = await db
    .from("booking")
    .select("id, renter_name, requested_by, status")
    .eq("church_id", churchId)
    .eq("status", "approved")
    .lt("starts_at_utc", range.to)
    .gt("ends_at_utc", range.from);
  if (bErr) throw new Error(`listUtilizationBlocks bookings: ${bErr.message}`);
  const list = (bookings ?? []) as {
    id: string;
    renter_name: string | null;
    requested_by: string | null;
    status: string;
  }[];
  if (list.length === 0) return [];
  const meta = new Map(list.map((b) => [b.id, b]));

  const { data: holds, error: hErr } = await db
    .from("booking_resource")
    .select("booking_id, resource_id, blocked_range, status")
    .in("booking_id", list.map((b) => b.id))
    .eq("status", "approved");
  if (hErr) throw new Error(`listUtilizationBlocks holds: ${hErr.message}`);

  const rows: UtilizationRow[] = [];
  for (const h of (holds ?? []) as BookingResource[]) {
    const r = parseTstzRange(h.blocked_range);
    if (!r) continue;
    const b = meta.get(h.booking_id);
    rows.push({
      booking_id: h.booking_id,
      resource_id: h.resource_id,
      start_ms: r.startMs,
      end_ms: r.endMs,
      is_external: Boolean(b?.renter_name) && !b?.requested_by,
      status: h.status,
    });
  }
  return rows;
}

// ── Signage feed (Phase 4) ─────────────────────────────────────────────────

export interface SignageSlot {
  title: string;
  starts: string;
  ends: string;
  event_type: string | null;
}
export interface SignageRoom {
  resource_id: string;
  resource_name: string;
  current: SignageSlot | null;
  next: SignageSlot | null;
}

/**
 * Current + next approved, signage-flagged booking per room for a church, as of
 * `now`. Reads the `booking.signage_board` RPC (migration 0023) via service-role;
 * church scoping is the caller's (it passes a server-verified church id).
 */
export async function getSignageBoard(
  churchId: string,
  now?: string,
): Promise<SignageRoom[]> {
  const db = createBookingAdminClient();
  const { data, error } = await db.rpc("signage_board", {
    p_church_id: churchId,
    p_now: now ?? new Date().toISOString(),
  });
  if (error) throw new Error(`getSignageBoard: ${error.message}`);
  return (data ?? []) as SignageRoom[];
}

/** Toggle a booking's signage flag, scoped to the church (guard in WHERE). */
export async function setBookingSignage(
  churchId: string,
  bookingId: string,
  showOnSignage: boolean,
): Promise<boolean> {
  const db = createBookingAdminClient();
  const { data, error } = await db
    .from("booking")
    .update({ show_on_signage: showOnSignage })
    .eq("id", bookingId)
    .eq("church_id", churchId)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`setBookingSignage: ${error.message}`);
  return Boolean(data);
}

// ── ICS feed reads (Phase 4) ────────────────────────────────────────────────

/**
 * Approved bookings holding `resourceId` in [from, to), for the ICS feed.
 * Returns the booking core times + title; the route builds the VCALENDAR.
 * Joined through booking_resource so we only emit this resource's holds.
 */
export async function listResourceBookingsForIcs(
  resourceId: string,
  range: { from: string; to: string },
): Promise<Booking[]> {
  const db = createBookingAdminClient();
  // booking_resource rows for this resource, then fetch their bookings.
  const { data: holds, error: holdErr } = await db
    .from("booking_resource")
    .select("booking_id")
    .eq("resource_id", resourceId)
    .eq("status", "approved");
  if (holdErr) throw new Error(`listResourceBookingsForIcs holds: ${holdErr.message}`);
  const ids = (holds ?? []).map((h) => (h as { booking_id: string }).booking_id);
  if (ids.length === 0) return [];

  const { data, error } = await db
    .from("booking")
    .select("*")
    .in("id", ids)
    .eq("status", "approved")
    .lt("starts_at_utc", range.to)
    .gt("ends_at_utc", range.from)
    .order("starts_at_utc");
  if (error) throw new Error(`listResourceBookingsForIcs: ${error.message}`);
  return (data ?? []) as Booking[];
}

/** A resource by id, or null. NOT church-scoped — callers check ownership. */
export async function getResourceById(resourceId: string): Promise<Resource | null> {
  const db = createBookingAdminClient();
  const { data, error } = await db
    .from("resource")
    .select("*")
    .eq("id", resourceId)
    .maybeSingle();
  if (error) throw new Error(`getResourceById: ${error.message}`);
  return (data as Resource | null) ?? null;
}

// ── AI quota (Phase 4) ──────────────────────────────────────────────────────

export interface AiQuotaRow {
  plan_tier: string;
  ai_quota_used: number;
  ai_quota_used_at_reset: string;
}

/**
 * Read the church's plan tier + AI-parse counter for the NL-booking gate.
 * plan_tier lives on public.church; the counter on public.church_settings.
 */
export async function getAiQuotaRow(churchId: string): Promise<AiQuotaRow> {
  const db = createAdminClient();
  const [{ data: church, error: cErr }, { data: settings, error: sErr }] =
    await Promise.all([
      db.from("church").select("plan_tier").eq("id", churchId).maybeSingle(),
      db
        .from("church_settings")
        .select("ai_quota_used, ai_quota_used_at_reset")
        .eq("church_id", churchId)
        .maybeSingle(),
    ]);
  if (cErr) throw new Error(`getAiQuotaRow church: ${cErr.message}`);
  if (sErr) throw new Error(`getAiQuotaRow settings: ${sErr.message}`);
  return {
    plan_tier: (church?.plan_tier as string | undefined) ?? "free",
    ai_quota_used: (settings?.ai_quota_used as number | undefined) ?? 0,
    ai_quota_used_at_reset:
      (settings?.ai_quota_used_at_reset as string | undefined) ??
      new Date().toISOString(),
  };
}

/** Whether the church has opted into cloud AI (church_settings.ai_consent). */
export async function getAiConsent(churchId: string): Promise<boolean> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("church_settings")
    .select("ai_consent")
    .eq("church_id", churchId)
    .maybeSingle();
  if (error) throw new Error(`getAiConsent: ${error.message}`);
  return Boolean(data?.ai_consent);
}

/** Persist the AI-parse counter after a successful (gated) parse. */
export async function bumpAiQuota(
  churchId: string,
  nextUsed: number,
  resetTimestamp: boolean,
): Promise<void> {
  const db = createAdminClient();
  const patch: Record<string, unknown> = { ai_quota_used: nextUsed };
  if (resetTimestamp) patch.ai_quota_used_at_reset = new Date().toISOString();
  const { error } = await db
    .from("church_settings")
    .update(patch)
    .eq("church_id", churchId);
  if (error) throw new Error(`bumpAiQuota: ${error.message}`);
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
