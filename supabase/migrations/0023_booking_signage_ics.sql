-- SundayBooking migration 0023 — signage feed, AI quota, ICS support.
--
-- Phase 4 additions, all idempotent + additive (re-runnable):
--   1. booking.displayable — a VIEW of approved, signage-flagged bookings with
--      the room name + now/next semantics, consumed by a foyer-screen feed
--      (GET /api/signage/[churchSlug]) and, in the separate SundayInfo repo, by
--      its display surface. show_on_signage already exists on booking.booking
--      (migration 0022); this just exposes the curated, joined read.
--   2. church_settings.ai_quota_used + ai_quota_used_at_reset — the per-church
--      monthly AI-parse counter the NL-booking route enforces (mirrors the
--      existing sms_quota_used pattern from migration 0002).
--
-- DEPLOY NOTE: the `booking` schema is already exposed for PostgREST (see 0022's
-- deploy note). Views in an exposed schema are readable through PostgREST too,
-- but the signage feed reads via the SERVICE-ROLE client server-side and scopes
-- by a verified church id/slug, so no client ever queries the view directly.

-- ── 1. AI quota counter on church_settings ───────────────────────────────────
alter table public.church_settings
  add column if not exists ai_quota_used          int         not null default 0;
alter table public.church_settings
  add column if not exists ai_quota_used_at_reset timestamptz not null default now();

-- ── 2. booking.displayable view ──────────────────────────────────────────────
-- Approved bookings flagged for signage, joined to their PRIMARY room/resource
-- name. now/next semantics are left to the reader (the feed picks "current" vs
-- "next" per resource using the caller's clock), so the view just exposes the
-- raw, filtered, joined rows ordered by start. We surface ONE resource per
-- booking (the lexically-first room it holds) as the signage "location", since a
-- foyer screen shows a room board.
--
-- CREATE OR REPLACE keeps it idempotent. We pick the room-kind resource if the
-- booking holds one, else the first resource, via a lateral lookup.
create or replace view booking.displayable as
  select
    b.id              as booking_id,
    b.church_id       as church_id,
    -- PII-safe signage label: a foyer screen is a PUBLIC surface, so we never
    -- expose the raw booking.title for an EXTERNAL rental (its title embeds the
    -- renter's name, e.g. "Bryllup — Ola Nordmann"). For external rentals
    -- (renter_name present) we fall back to the event-type name, else a generic
    -- "Privat arrangement". Internal bookings (no renter_name) keep their title.
    case
      when b.renter_name is not null and b.renter_name <> ''
        then coalesce(et.name, 'Privat arrangement')
      else b.title
    end               as title,
    b.starts_at_utc   as starts_at_utc,
    b.ends_at_utc     as ends_at_utc,
    b.event_type_id   as event_type_id,
    et.name           as event_type_name,
    loc.resource_id   as resource_id,
    loc.resource_name as resource_name
  from booking.booking b
  left join booking.event_type et on et.id = b.event_type_id
  left join lateral (
    select r.id as resource_id, r.name as resource_name
      from booking.booking_resource br
      join booking.resource r on r.id = br.resource_id
     where br.booking_id = b.id
     order by (r.kind = 'room') desc, r.name
     limit 1
  ) loc on true
  where b.status = 'approved'
    and b.show_on_signage = true;

-- Views run with the privileges of the querying role under RLS by default;
-- grant select so the service-role (and, if ever queried directly, the API
-- roles subject to the underlying tables' RLS) can read it.
grant select on booking.displayable to anon, authenticated, service_role;

-- A helper RPC: current + next displayable booking per room for a church, as of
-- a supplied instant. SECURITY DEFINER so the service-role feed gets a single
-- round-trip; church scoping is the caller's responsibility (it always passes a
-- server-verified church id). Returns one row per resource that has either a
-- currently-running or an upcoming approved+signage booking.
create or replace function booking.signage_board(
  p_church_id uuid,
  p_now timestamptz default now()
) returns jsonb
language sql stable
security definer
set search_path = booking, public
as $$
  with rooms as (
    select distinct resource_id, resource_name
      from booking.displayable
     where church_id = p_church_id
       and resource_id is not null
       and ends_at_utc > p_now
  ),
  cur as (
    select distinct on (d.resource_id)
           d.resource_id, d.title, d.starts_at_utc, d.ends_at_utc, d.event_type_name
      from booking.displayable d
     where d.church_id = p_church_id
       and d.starts_at_utc <= p_now
       and d.ends_at_utc   >  p_now
     order by d.resource_id, d.starts_at_utc
  ),
  nxt as (
    select distinct on (d.resource_id)
           d.resource_id, d.title, d.starts_at_utc, d.ends_at_utc, d.event_type_name
      from booking.displayable d
     where d.church_id = p_church_id
       and d.starts_at_utc > p_now
     order by d.resource_id, d.starts_at_utc
  )
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'resource_id',   rooms.resource_id,
             'resource_name', rooms.resource_name,
             'current', case when cur.resource_id is null then null else jsonb_build_object(
               'title', cur.title, 'starts', cur.starts_at_utc, 'ends', cur.ends_at_utc,
               'event_type', cur.event_type_name) end,
             'next', case when nxt.resource_id is null then null else jsonb_build_object(
               'title', nxt.title, 'starts', nxt.starts_at_utc, 'ends', nxt.ends_at_utc,
               'event_type', nxt.event_type_name) end
           )
           order by rooms.resource_name
         ), '[]'::jsonb)
    from rooms
    left join cur on cur.resource_id = rooms.resource_id
    left join nxt on nxt.resource_id = rooms.resource_id;
$$;

grant execute on function booking.signage_board(uuid, timestamptz) to authenticated, service_role;
