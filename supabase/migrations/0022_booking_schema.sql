-- SundayBooking migration 0022 — the booking correctness core.
--
-- Goal: it must be STRUCTURALLY IMPOSSIBLE to double-book a resource. The
-- guarantee is a GiST exclusion constraint over (resource_id, blocked_range)
-- on booking.booking_resource, scoped to status='approved'. Two approved
-- bookings whose effective ranges (incl. setup/teardown buffers) overlap on
-- the same resource cannot both exist — Postgres rejects the second insert.
--
-- Everything is church_id-scoped to public.church and idempotent + additive:
-- tables are CREATE ... IF NOT EXISTS, functions are CREATE OR REPLACE,
-- publication adds are guarded. Writes flow ONLY through the SECURITY DEFINER
-- RPCs below; authenticated has SELECT (RLS) but no direct write policies.
--
-- DEPLOY NOTE: the `booking` schema must be exposed in the Supabase dashboard
-- (Settings → API → Exposed schemas) at deploy time — config push / SQL alone
-- does not expose a non-public schema to PostgREST.

create extension if not exists btree_gist;

create schema if not exists booking;

-- ── resource ────────────────────────────────────────────────────────────────
create table if not exists booking.resource (
  id                  uuid primary key default gen_random_uuid(),
  church_id           uuid not null references public.church(id) on delete cascade,
  kind                text not null check (kind in ('room','equipment','person','vehicle')),
  name                text not null,
  description         text,
  capacity            int,
  site                text,
  color               text,
  default_setup_min   int not null default 0,
  default_teardown_min int not null default 0,
  bookable_by         text not null default 'staff' check (bookable_by in ('staff','members','public')),
  requires_approval   boolean not null default true,
  member_id           uuid,            -- nullable; set when kind='person'
  status              text not null default 'active',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (church_id, name)
);

-- ── event_type ──────────────────────────────────────────────────────────────
create table if not exists booking.event_type (
  id                  uuid primary key default gen_random_uuid(),
  church_id           uuid not null references public.church(id) on delete cascade,
  name                text not null,
  default_setup_min   int not null default 0,
  default_teardown_min int not null default 0,
  default_duration_min int not null default 60,
  color               text,
  requires_approval   boolean not null default true,
  terms               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (church_id, name)
);

-- ── resource_bundle + bundle_item ───────────────────────────────────────────
-- A bundle = a primary resource plus a set of included resources, so booking
-- "the main hall" can auto-include "the main hall PA + projector".
create table if not exists booking.resource_bundle (
  id                  uuid primary key default gen_random_uuid(),
  church_id           uuid not null references public.church(id) on delete cascade,
  name                text not null,
  primary_resource_id uuid not null references booking.resource(id) on delete cascade,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (church_id, name)
);

create table if not exists booking.bundle_item (
  bundle_id   uuid not null references booking.resource_bundle(id) on delete cascade,
  resource_id uuid not null references booking.resource(id) on delete cascade,
  primary key (bundle_id, resource_id)
);

-- ── series (recurrence template) ────────────────────────────────────────────
create table if not exists booking.series (
  id          uuid primary key default gen_random_uuid(),
  church_id   uuid not null references public.church(id) on delete cascade,
  rrule       text,
  exdates     date[] not null default '{}',
  template    jsonb,
  created_at  timestamptz not null default now()
);

-- ── booking ─────────────────────────────────────────────────────────────────
create table if not exists booking.booking (
  id              uuid primary key default gen_random_uuid(),
  church_id       uuid not null references public.church(id) on delete cascade,
  event_type_id   uuid references booking.event_type(id),
  requested_by    uuid,                 -- nullable: external/public renters have no auth user
  title           text not null,
  purpose         text,
  starts_at_utc   timestamptz not null,
  ends_at_utc     timestamptz not null,
  setup_min       int not null default 0,
  teardown_min    int not null default 0,
  status          text not null default 'pending'
                    check (status in ('pending','approved','declined','cancelled')),
  approved_by     uuid,
  -- public.service exists (migration 0002): link a booking to a planned service.
  service_id      uuid references public.service(id) on delete set null,
  series_id       uuid references booking.series(id) on delete set null,
  renter_name     text,
  renter_contact  text,
  show_on_signage boolean not null default false,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (ends_at_utc > starts_at_utc)
);

create index if not exists booking_church_idx  on booking.booking (church_id);
create index if not exists booking_service_idx on booking.booking (service_id);
create index if not exists booking_series_idx  on booking.booking (series_id);

-- ── booking_resource ────────────────────────────────────────────────────────
-- One row per resource a booking holds. blocked_range + status are MIRRORED
-- from the parent booking by triggers (never written directly by app code) so
-- the exclusion constraint below always sees the truth.
create table if not exists booking.booking_resource (
  booking_id    uuid not null references booking.booking(id) on delete cascade,
  resource_id   uuid not null references booking.resource(id) on delete cascade,
  blocked_range tstzrange not null,
  status        text not null,
  primary key (booking_id, resource_id)
);

create index if not exists booking_resource_resource_idx on booking.booking_resource (resource_id);

-- ★ THE DOUBLE-BOOKING GUARANTEE ★
-- No two APPROVED rows for the same resource may have overlapping ranges.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'booking_resource_no_overlap'
      and conrelid = 'booking.booking_resource'::regclass
  ) then
    alter table booking.booking_resource
      add constraint booking_resource_no_overlap
      exclude using gist (resource_id with =, blocked_range with &&)
      where (status = 'approved');
  end if;
end $$;

-- ── availability (person/appointment bookable windows) ──────────────────────
create table if not exists booking.availability (
  id          uuid primary key default gen_random_uuid(),
  resource_id uuid not null references booking.resource(id) on delete cascade,
  weekday     int not null check (weekday between 0 and 6),  -- 0=Sunday … 6=Saturday
  start_time  time not null,
  end_time    time not null,
  check (end_time > start_time)
);

-- ── events (realtime feed) ──────────────────────────────────────────────────
create table if not exists booking.events (
  id          uuid primary key default gen_random_uuid(),
  church_id   uuid not null references public.church(id) on delete cascade,
  booking_id  uuid references booking.booking(id) on delete cascade,
  type        text not null,
  payload     jsonb,
  created_at  timestamptz not null default now()
);

-- ── updated_at triggers ──────────────────────────────────────────────────────
drop trigger if exists set_updated_at_booking_resource    on booking.resource;
drop trigger if exists set_updated_at_booking_event_type  on booking.event_type;
drop trigger if exists set_updated_at_booking_bundle      on booking.resource_bundle;
drop trigger if exists set_updated_at_booking_booking     on booking.booking;

create trigger set_updated_at_booking_resource
  before update on booking.resource
  for each row execute function public.set_updated_at();
create trigger set_updated_at_booking_event_type
  before update on booking.event_type
  for each row execute function public.set_updated_at();
create trigger set_updated_at_booking_bundle
  before update on booking.resource_bundle
  for each row execute function public.set_updated_at();
create trigger set_updated_at_booking_booking
  before update on booking.booking
  for each row execute function public.set_updated_at();

-- ── range/status mirror trigger ──────────────────────────────────────────────
-- Single source of truth: the parent booking. This recomputes every child
-- booking_resource.blocked_range (incl. setup/teardown buffer) and copies the
-- status, so the exclusion constraint can do its job. Fired AFTER UPDATE of the
-- relevant columns on booking.booking.
create or replace function booking.sync_booking_resources()
returns trigger
language plpgsql
security definer
set search_path = booking, public
as $$
begin
  update booking.booking_resource br
     set blocked_range = tstzrange(
           new.starts_at_utc - (new.setup_min    * interval '1 minute'),
           new.ends_at_utc   + (new.teardown_min * interval '1 minute'),
           '[)'
         ),
         status = new.status
   where br.booking_id = new.id;
  return new;
end;
$$;

drop trigger if exists sync_booking_resources_trg on booking.booking;
create trigger sync_booking_resources_trg
  after update of starts_at_utc, ends_at_utc, setup_min, teardown_min, status
  on booking.booking
  for each row execute function booking.sync_booking_resources();

-- ═══════════════════════════════════════════════════════════════════════════
-- RPCs (SECURITY DEFINER). All writes go through these; authenticated has no
-- direct write policies.
-- ═══════════════════════════════════════════════════════════════════════════

-- Effective range helper (pure).
create or replace function booking.effective_range(
  p_starts timestamptz, p_ends timestamptz, p_setup_min int, p_teardown_min int
) returns tstzrange
language sql immutable
set search_path = booking, public
as $$
  select tstzrange(
    p_starts - (coalesce(p_setup_min,0)    * interval '1 minute'),
    p_ends   + (coalesce(p_teardown_min,0) * interval '1 minute'),
    '[)'
  );
$$;

-- suggest_alternatives — nearest N free windows on a resource, deterministic.
-- Walks approved blocks on the resource and returns gap windows of at least the
-- requested duration, starting at/after the requested start.
create or replace function booking.suggest_alternatives(
  p_resource_id uuid,
  p_starts timestamptz,
  p_ends timestamptz,
  p_setup_min int,
  p_teardown_min int,
  p_limit int default 3
) returns jsonb
language plpgsql stable
security definer
set search_path = booking, public
as $$
declare
  v_dur     interval := (p_ends - p_starts)
                        + (coalesce(p_setup_min,0)    * interval '1 minute')
                        + (coalesce(p_teardown_min,0) * interval '1 minute');
  v_cursor  timestamptz := p_starts - (coalesce(p_setup_min,0) * interval '1 minute');
  v_results jsonb := '[]'::jsonb;
  v_count   int := 0;
  r         record;
begin
  -- Iterate approved blocked ranges on this resource in time order. For each,
  -- if there is room before it starts, emit that gap as a candidate; then jump
  -- the cursor past the block.
  for r in
    select blocked_range
      from booking.booking_resource
     where resource_id = p_resource_id
       and status = 'approved'
       and upper(blocked_range) > v_cursor
     order by lower(blocked_range)
  loop
    if lower(r.blocked_range) - v_cursor >= v_dur then
      v_results := v_results || jsonb_build_object(
        'starts', v_cursor + (coalesce(p_setup_min,0) * interval '1 minute'),
        'ends',   v_cursor + (coalesce(p_setup_min,0) * interval '1 minute') + (p_ends - p_starts)
      );
      v_count := v_count + 1;
      exit when v_count >= p_limit;
    end if;
    if upper(r.blocked_range) > v_cursor then
      v_cursor := upper(r.blocked_range);
    end if;
  end loop;

  -- After the last block (or if no blocks) the resource is free indefinitely.
  if v_count < p_limit then
    v_results := v_results || jsonb_build_object(
      'starts', v_cursor + (coalesce(p_setup_min,0) * interval '1 minute'),
      'ends',   v_cursor + (coalesce(p_setup_min,0) * interval '1 minute') + (p_ends - p_starts)
    );
  end if;

  return v_results;
end;
$$;

-- request_booking — all-or-nothing across all requested resources.
create or replace function booking.request_booking(
  p_church_id uuid,
  p_resource_ids uuid[],
  p_event_type_id uuid,
  p_title text,
  p_starts timestamptz,
  p_ends timestamptz,
  p_setup_min int,
  p_teardown_min int,
  p_requested_by uuid,
  p_renter_name text default null,
  p_renter_contact text default null
) returns jsonb
language plpgsql
security definer
set search_path = booking, public
as $$
declare
  v_range          tstzrange;
  v_conflicts      jsonb := '[]'::jsonb;
  v_alternatives   jsonb := '[]'::jsonb;
  v_requires       boolean := false;
  v_status         text;
  v_booking_id     uuid;
  v_rid            uuid;
  v_res            record;
  v_conflict_count int;
begin
  if p_resource_ids is null or array_length(p_resource_ids, 1) is null then
    raise exception 'request_booking: at least one resource is required';
  end if;
  if p_ends <= p_starts then
    raise exception 'request_booking: ends must be after starts';
  end if;

  v_range := booking.effective_range(p_starts, p_ends, p_setup_min, p_teardown_min);

  -- Lock the target resource rows so two concurrent requests serialize on them.
  perform 1 from booking.resource
   where id = any(p_resource_ids) and church_id = p_church_id
   for update;

  -- Approval gate: required if the event_type OR any resource requires it.
  if p_event_type_id is not null then
    select coalesce(requires_approval, false) into v_requires
      from booking.event_type where id = p_event_type_id;
  end if;
  if exists (
    select 1 from booking.resource
     where id = any(p_resource_ids) and requires_approval
  ) then
    v_requires := true;
  end if;
  v_status := case when v_requires then 'pending' else 'approved' end;

  -- Conflict check: ANY overlapping APPROVED hold on ANY requested resource
  -- blocks the whole request (atomic for bundles/multi-resource). We check
  -- against approved holds regardless of the new status, because a pending
  -- request that overlaps an approved one cannot later be approved.
  foreach v_rid in array p_resource_ids loop
    select count(*) into v_conflict_count
      from booking.booking_resource br
     where br.resource_id = v_rid
       and br.status = 'approved'
       and br.blocked_range && v_range;

    if v_conflict_count > 0 then
      v_conflicts := v_conflicts || jsonb_build_object(
        'resource_id', v_rid,
        'conflicts', (
          select coalesce(jsonb_agg(jsonb_build_object(
                   'booking_id', br.booking_id,
                   'range', jsonb_build_object('starts', lower(br.blocked_range),
                                               'ends',   upper(br.blocked_range)))), '[]'::jsonb)
            from booking.booking_resource br
           where br.resource_id = v_rid
             and br.status = 'approved'
             and br.blocked_range && v_range
        )
      );
      v_alternatives := v_alternatives || jsonb_build_object(
        'resource_id', v_rid,
        'windows', booking.suggest_alternatives(v_rid, p_starts, p_ends, p_setup_min, p_teardown_min)
      );
    end if;
  end loop;

  if jsonb_array_length(v_conflicts) > 0 then
    return jsonb_build_object('ok', false, 'conflicts', v_conflicts, 'alternatives', v_alternatives);
  end if;

  -- No conflicts → insert booking + one booking_resource per resource.
  insert into booking.booking (
    church_id, event_type_id, requested_by, title,
    starts_at_utc, ends_at_utc, setup_min, teardown_min, status,
    renter_name, renter_contact
  ) values (
    p_church_id, p_event_type_id, p_requested_by, p_title,
    p_starts, p_ends, coalesce(p_setup_min,0), coalesce(p_teardown_min,0), v_status,
    p_renter_name, p_renter_contact
  ) returning id into v_booking_id;

  foreach v_rid in array p_resource_ids loop
    insert into booking.booking_resource (booking_id, resource_id, blocked_range, status)
    values (v_booking_id, v_rid, v_range, v_status);
  end loop;

  insert into booking.events (church_id, booking_id, type, payload)
  values (p_church_id, v_booking_id, 'booking_requested',
          jsonb_build_object('status', v_status));

  return jsonb_build_object('ok', true, 'booking_id', v_booking_id, 'status', v_status);
exception
  when exclusion_violation then
    -- Lost a race to another approval/insert on the same slot.
    return jsonb_build_object('ok', false, 'conflict', true);
end;
$$;

-- approve_booking — re-checks conflict, flips to approved; the mirror trigger
-- propagates the status to children, where the exclusion constraint enforces
-- correctness. If it raises, we report a conflict instead of erroring.
create or replace function booking.approve_booking(
  p_booking_id uuid,
  p_approver uuid
) returns jsonb
language plpgsql
security definer
set search_path = booking, public
as $$
declare
  v_church uuid;
begin
  select church_id into v_church from booking.booking where id = p_booking_id for update;
  if v_church is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  -- Lock the resources this booking touches to serialize concurrent approvals.
  perform 1 from booking.booking_resource where booking_id = p_booking_id for update;

  update booking.booking
     set status = 'approved', approved_by = p_approver
   where id = p_booking_id;

  insert into booking.events (church_id, booking_id, type, payload)
  values (v_church, p_booking_id, 'booking_approved', jsonb_build_object('by', p_approver));

  return jsonb_build_object('ok', true, 'booking_id', p_booking_id, 'status', 'approved');
exception
  when exclusion_violation then
    return jsonb_build_object('ok', false, 'conflict', true);
end;
$$;

create or replace function booking.decline_booking(
  p_booking_id uuid,
  p_approver uuid
) returns jsonb
language plpgsql
security definer
set search_path = booking, public
as $$
declare
  v_church uuid;
begin
  select church_id into v_church from booking.booking where id = p_booking_id for update;
  if v_church is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  update booking.booking
     set status = 'declined', approved_by = p_approver
   where id = p_booking_id;
  insert into booking.events (church_id, booking_id, type, payload)
  values (v_church, p_booking_id, 'booking_declined', jsonb_build_object('by', p_approver));
  return jsonb_build_object('ok', true, 'booking_id', p_booking_id, 'status', 'declined');
end;
$$;

create or replace function booking.cancel_booking(
  p_booking_id uuid,
  p_actor uuid
) returns jsonb
language plpgsql
security definer
set search_path = booking, public
as $$
declare
  v_church uuid;
begin
  select church_id into v_church from booking.booking where id = p_booking_id for update;
  if v_church is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  update booking.booking
     set status = 'cancelled'
   where id = p_booking_id;
  insert into booking.events (church_id, booking_id, type, payload)
  values (v_church, p_booking_id, 'booking_cancelled', jsonb_build_object('by', p_actor));
  return jsonb_build_object('ok', true, 'booking_id', p_booking_id, 'status', 'cancelled');
end;
$$;

-- seed_default_event_types — idempotent Norwegian defaults.
create or replace function booking.seed_default_event_types(p_church_id uuid)
returns void
language plpgsql
security definer
set search_path = booking, public
as $$
begin
  insert into booking.event_type (church_id, name, default_setup_min, default_teardown_min, requires_approval)
  values
    (p_church_id, 'bryllup',      120, 120, true),
    (p_church_id, 'begravelse',    60,  60, true),
    (p_church_id, 'dåp',           30,  30, true),
    (p_church_id, 'konfirmasjon',  90,  90, true),
    (p_church_id, 'korøvelse',     15,  15, false),
    (p_church_id, 'dugnad',         0,  30, false),
    (p_church_id, 'møte',          10,  10, false),
    (p_church_id, 'gudstjeneste',  30,  30, true)
  on conflict (church_id, name) do nothing;
end;
$$;

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table booking.resource         enable row level security;
alter table booking.event_type       enable row level security;
alter table booking.resource_bundle  enable row level security;
alter table booking.bundle_item      enable row level security;
alter table booking.series           enable row level security;
alter table booking.booking          enable row level security;
alter table booking.booking_resource enable row level security;
alter table booking.availability     enable row level security;
alter table booking.events           enable row level security;

-- SELECT scoped via the 0001 helper. No direct write policies for
-- authenticated — all writes go through the SECURITY DEFINER RPCs above
-- (which run as owner and bypass RLS).
drop policy if exists booking_resource_read         on booking.resource;
drop policy if exists booking_event_type_read       on booking.event_type;
drop policy if exists booking_bundle_read           on booking.resource_bundle;
drop policy if exists booking_series_read           on booking.series;
drop policy if exists booking_booking_read          on booking.booking;
drop policy if exists booking_events_read           on booking.events;
drop policy if exists booking_bundle_item_read      on booking.bundle_item;
drop policy if exists booking_availability_read     on booking.availability;
drop policy if exists booking_booking_resource_read on booking.booking_resource;

create policy booking_resource_read    on booking.resource         for select using (public.is_member_of(church_id));
create policy booking_event_type_read  on booking.event_type       for select using (public.is_member_of(church_id));
create policy booking_bundle_read      on booking.resource_bundle  for select using (public.is_member_of(church_id));
create policy booking_series_read      on booking.series           for select using (public.is_member_of(church_id));
create policy booking_booking_read     on booking.booking          for select using (public.is_member_of(church_id));
create policy booking_events_read      on booking.events           for select using (public.is_member_of(church_id));

-- Join tables / children: scope through their parent's church.
create policy booking_bundle_item_read on booking.bundle_item for select using (
  exists (select 1 from booking.resource_bundle b
           where b.id = bundle_id and public.is_member_of(b.church_id))
);
create policy booking_availability_read on booking.availability for select using (
  exists (select 1 from booking.resource r
           where r.id = resource_id and public.is_member_of(r.church_id))
);
create policy booking_booking_resource_read on booking.booking_resource for select using (
  exists (select 1 from booking.booking b
           where b.id = booking_id and public.is_member_of(b.church_id))
);

-- ── Grants (mirror Supabase: API roles get broad privs, RLS is the gate) ─────
grant usage on schema booking to anon, authenticated, service_role;
grant select on all tables in schema booking to anon, authenticated;
grant all    on all tables in schema booking to service_role;
grant execute on all functions in schema booking to authenticated, service_role;

-- RPC execute (explicit, matches suite style).
grant execute on function booking.request_booking(uuid, uuid[], uuid, text, timestamptz, timestamptz, int, int, uuid, text, text) to authenticated, service_role;
grant execute on function booking.approve_booking(uuid, uuid) to authenticated, service_role;
grant execute on function booking.decline_booking(uuid, uuid) to authenticated, service_role;
grant execute on function booking.cancel_booking(uuid, uuid) to authenticated, service_role;
grant execute on function booking.suggest_alternatives(uuid, timestamptz, timestamptz, int, int, int) to authenticated, service_role;
grant execute on function booking.seed_default_event_types(uuid) to authenticated, service_role;

-- ── Realtime publication (guarded; tables may already be members) ────────────
do $$
begin
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime'
                    and schemaname = 'booking' and tablename = 'events') then
    alter publication supabase_realtime add table booking.events;
  end if;
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime'
                    and schemaname = 'booking' and tablename = 'booking') then
    alter publication supabase_realtime add table booking.booking;
  end if;
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime'
                    and schemaname = 'booking' and tablename = 'resource') then
    alter publication supabase_realtime add table booking.resource;
  end if;
end $$;
