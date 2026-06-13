-- SundayBooking migration 0024 — external-rental monetization.
--
-- Phase 5 additions, all idempotent + additive (re-runnable):
--   1. Rental fields on booking.resource + booking.event_type:
--      rental_price_nok numeric, deposit_pct int, cancellation_policy text —
--      so a "room" can carry a rental price + deposit % + cancellation terms.
--   2. booking.rental_agreement — a per-booking FROZEN snapshot of the rental
--      terms (price/deposit/cancellation/liability/terms + church/renter/resource
--      /date) at request time, the rendered Norwegian agreement HTML, and the
--      renter's cryptographic e-acceptance (accepted_at + the status-token jti).
--      A snapshot makes the agreement immutable even if the resource price later
--      changes — what the renter accepted is what was shown.
--   3. booking.booking.payment_status — a deposit/payment lifecycle column,
--      flipped by the Vipps payment seam (stub-safe by default).
--
-- The payment PROVIDER itself is a code seam (apps/booking/lib/payments.ts) with
-- a keyless StubVippsProvider fallback — no secrets live here. This migration is
-- only the data shape the seam reads/writes.
--
-- DEPLOY NOTE: the `booking` schema is already exposed for PostgREST (see 0022's
-- deploy note). After applying this, reload the PostgREST schema cache
-- (Supabase: NOTIFY pgrst, 'reload schema'; or the dashboard "Reload" action)
-- so the new columns/table are visible to the API. Real Vipps additionally needs
-- merchant client_id/client_secret/subscription-key set as Worker secrets — see
-- apps/booking/lib/payments.ts (paymentsConfigured()).

-- ── 1. Rental fields on resource + event_type ─────────────────────────────────
alter table booking.resource
  add column if not exists rental_price_nok    numeric(10,2);
alter table booking.resource
  add column if not exists deposit_pct         int;
alter table booking.resource
  add column if not exists cancellation_policy text;

-- Guard the deposit_pct range (0..100) idempotently.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'resource_deposit_pct_range'
      and conrelid = 'booking.resource'::regclass
  ) then
    alter table booking.resource
      add constraint resource_deposit_pct_range
      check (deposit_pct is null or (deposit_pct >= 0 and deposit_pct <= 100));
  end if;
end $$;

alter table booking.event_type
  add column if not exists rental_price_nok    numeric(10,2);
alter table booking.event_type
  add column if not exists deposit_pct         int;
alter table booking.event_type
  add column if not exists cancellation_policy text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'event_type_deposit_pct_range'
      and conrelid = 'booking.event_type'::regclass
  ) then
    alter table booking.event_type
      add constraint event_type_deposit_pct_range
      check (deposit_pct is null or (deposit_pct >= 0 and deposit_pct <= 100));
  end if;
end $$;

-- ── 2. payment_status lifecycle on booking ────────────────────────────────────
-- none → deposit_pending → deposit_paid → paid → refunded. The Vipps seam flips
-- this; 'none' is the default for non-priced / member / staff bookings.
alter table booking.booking
  add column if not exists payment_status text not null default 'none';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'booking_payment_status_check'
      and conrelid = 'booking.booking'::regclass
  ) then
    alter table booking.booking
      add constraint booking_payment_status_check
      check (payment_status in ('none','deposit_pending','deposit_paid','paid','refunded'));
  end if;
end $$;

-- An opaque payment-provider reference (Vipps order id / stub id), nullable.
alter table booking.booking
  add column if not exists payment_reference text;

-- ── 3. booking.rental_agreement ───────────────────────────────────────────────
-- One frozen agreement per booking. snapshot is the immutable record of what was
-- shown/agreed; agreement_html is the rendered Norwegian document; accepted_at +
-- accepted_token_jti capture the renter's cryptographic e-acceptance (the jti of
-- the status-link token they were holding when they clicked "Jeg godtar").
create table if not exists booking.rental_agreement (
  id                 uuid primary key default gen_random_uuid(),
  booking_id         uuid not null references booking.booking(id) on delete cascade,
  church_id          uuid not null references public.church(id) on delete cascade,
  snapshot           jsonb not null,
  agreement_html     text not null,
  accepted_at        timestamptz,
  accepted_token_jti text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (booking_id)
);

create index if not exists rental_agreement_church_idx on booking.rental_agreement (church_id);

drop trigger if exists set_updated_at_rental_agreement on booking.rental_agreement;
create trigger set_updated_at_rental_agreement
  before update on booking.rental_agreement
  for each row execute function public.set_updated_at();

-- ── RPCs (SECURITY DEFINER) ───────────────────────────────────────────────────

-- capture_rental_agreement — freeze the agreement snapshot + rendered HTML for a
-- booking. Idempotent: re-capture updates the snapshot/html (until accepted; we
-- never clobber an existing acceptance). The HTML is rendered app-side (pure
-- builder in lib/rental-agreement.ts); this RPC only persists it.
create or replace function booking.capture_rental_agreement(
  p_booking_id uuid,
  p_church_id  uuid,
  p_snapshot   jsonb,
  p_html       text
) returns jsonb
language plpgsql
security definer
set search_path = booking, public
as $$
declare
  v_exists boolean;
begin
  if not exists (
    select 1 from booking.booking
     where id = p_booking_id and church_id = p_church_id
  ) then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  insert into booking.rental_agreement (booking_id, church_id, snapshot, agreement_html)
  values (p_booking_id, p_church_id, p_snapshot, p_html)
  on conflict (booking_id) do update
    set snapshot       = excluded.snapshot,
        agreement_html = excluded.agreement_html
    -- Never overwrite a captured acceptance.
    where booking.rental_agreement.accepted_at is null;

  return jsonb_build_object('ok', true, 'booking_id', p_booking_id);
end;
$$;

-- accept_rental_agreement — record the renter's e-acceptance (accepted_at + the
-- jti of the status token they held). Idempotent: re-accept is a no-op once set.
create or replace function booking.accept_rental_agreement(
  p_booking_id uuid,
  p_church_id  uuid,
  p_token_jti  text
) returns jsonb
language plpgsql
security definer
set search_path = booking, public
as $$
declare
  v_already timestamptz;
begin
  select accepted_at into v_already
    from booking.rental_agreement
   where booking_id = p_booking_id and church_id = p_church_id
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if v_already is not null then
    return jsonb_build_object('ok', true, 'already', true, 'accepted_at', v_already);
  end if;

  update booking.rental_agreement
     set accepted_at        = now(),
         accepted_token_jti = p_token_jti
   where booking_id = p_booking_id and church_id = p_church_id;

  return jsonb_build_object('ok', true, 'already', false);
end;
$$;

-- set_payment_status — flip the booking's payment lifecycle (called by the
-- payment seam: deposit intent created → deposit_pending; callback paid →
-- deposit_paid/paid; refund → refunded). Validates the value against the check.
create or replace function booking.set_payment_status(
  p_booking_id uuid,
  p_church_id  uuid,
  p_status     text,
  p_reference  text default null
) returns jsonb
language plpgsql
security definer
set search_path = booking, public
as $$
declare
  v_church uuid;
begin
  if p_status not in ('none','deposit_pending','deposit_paid','paid','refunded') then
    return jsonb_build_object('ok', false, 'error', 'invalid_status');
  end if;

  select church_id into v_church
    from booking.booking
   where id = p_booking_id and church_id = p_church_id
   for update;
  if v_church is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  update booking.booking
     set payment_status   = p_status,
         payment_reference = coalesce(p_reference, payment_reference)
   where id = p_booking_id;

  insert into booking.events (church_id, booking_id, type, payload)
  values (v_church, p_booking_id, 'payment_status_changed',
          jsonb_build_object('status', p_status, 'reference', p_reference));

  return jsonb_build_object('ok', true, 'payment_status', p_status);
end;
$$;

-- ── RLS ────────────────────────────────────────────────────────────────────────
alter table booking.rental_agreement enable row level security;

drop policy if exists booking_rental_agreement_read on booking.rental_agreement;
create policy booking_rental_agreement_read on booking.rental_agreement
  for select using (public.is_member_of(church_id));

-- ── Grants ──────────────────────────────────────────────────────────────────────
grant select on booking.rental_agreement to anon, authenticated;
grant all    on booking.rental_agreement to service_role;

grant execute on function booking.capture_rental_agreement(uuid, uuid, jsonb, text) to authenticated, service_role;
grant execute on function booking.accept_rental_agreement(uuid, uuid, text) to authenticated, service_role;
grant execute on function booking.set_payment_status(uuid, uuid, text, text) to authenticated, service_role;

-- ── Realtime publication (guarded) ────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime'
                    and schemaname = 'booking' and tablename = 'rental_agreement') then
    alter publication supabase_realtime add table booking.rental_agreement;
  end if;
end $$;
