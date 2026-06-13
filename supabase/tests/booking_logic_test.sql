-- SundayBooking correctness assertions (migration 0022).
-- The crown-jewel property: it is IMPOSSIBLE to double-book a resource.
-- Runs as a single psql script; any failed assertion raises and aborts.

\set ON_ERROR_STOP on

do $$
declare
  v_church  uuid;
  v_church2 uuid;
  v_user    uuid;
  v_roomA   uuid;
  v_roomB   uuid;
  v_proj    uuid;
  res       jsonb;
  n_before  bigint;
  n_after   bigint;
  v_bk      uuid;
  v_bk2     uuid;
begin
  -- ── fixtures ───────────────────────────────────────────────────────────────
  insert into auth.users (email) values ('booker@test.no') returning id into v_user;
  insert into public.church (name, slug) values ('Bookingkirken', 'bookingkirken') returning id into v_church;
  insert into public.church (name, slug) values ('Annenkirke',    'annenkirke')    returning id into v_church2;

  -- Resources that do NOT require approval, so request_booking lands 'approved'
  -- directly and we can exercise the exclusion constraint without a separate step.
  insert into booking.resource (church_id, kind, name, requires_approval)
    values (v_church, 'room', 'Storsalen', false) returning id into v_roomA;
  insert into booking.resource (church_id, kind, name, requires_approval)
    values (v_church, 'room', 'Lillesalen', false) returning id into v_roomB;
  insert into booking.resource (church_id, kind, name, requires_approval)
    values (v_church, 'equipment', 'Projektor', false) returning id into v_proj;

  -- seed_default_event_types is idempotent
  perform booking.seed_default_event_types(v_church);
  perform booking.seed_default_event_types(v_church);  -- twice = no error/dupes
  if (select count(*) from booking.event_type where church_id = v_church and name = 'gudstjeneste') <> 1 then
    raise exception 'FAIL: seed_default_event_types not idempotent';
  end if;
  raise notice 'PASS: seed_default_event_types idempotent (Norwegian types present)';

  -- ── Assertion 1: two approved overlapping bookings, same resource ───────────
  res := booking.request_booking(v_church, array[v_roomA], null, 'Møte 1',
           '2026-07-01 10:00+00', '2026-07-01 12:00+00', 0, 0, v_user);
  if not (res->>'ok')::boolean or res->>'status' <> 'approved' then
    raise exception 'FAIL(1a): first booking not approved: %', res;
  end if;

  res := booking.request_booking(v_church, array[v_roomA], null, 'Møte 2 (overlap)',
           '2026-07-01 11:00+00', '2026-07-01 13:00+00', 0, 0, v_user);
  if (res->>'ok')::boolean then
    raise exception 'FAIL(1b): overlapping approved booking was accepted: %', res;
  end if;
  if jsonb_array_length(res->'conflicts') < 1 then
    raise exception 'FAIL(1c): no conflicts reported: %', res;
  end if;
  raise notice 'PASS(1): overlapping approved booking on same resource rejected (with conflicts + alternatives)';

  -- ── Assertion 2: setup/teardown buffer blocks adjacent booking ──────────────
  -- A 14:00–18:00 with teardown 120 → blocked until 20:00.
  res := booking.request_booking(v_church, array[v_roomB], null, 'A m/ teardown',
           '2026-07-02 14:00+00', '2026-07-02 18:00+00', 0, 120, v_user);
  if not (res->>'ok')::boolean then raise exception 'FAIL(2a): base booking failed: %', res; end if;

  -- B at 19:00 → inside the teardown buffer → rejected.
  res := booking.request_booking(v_church, array[v_roomB], null, 'B kl 19',
           '2026-07-02 19:00+00', '2026-07-02 20:30+00', 0, 0, v_user);
  if (res->>'ok')::boolean then raise exception 'FAIL(2b): booking inside teardown buffer accepted: %', res; end if;

  -- B at 20:00 → buffer is '[)' so 20:00 is free → succeeds.
  res := booking.request_booking(v_church, array[v_roomB], null, 'B kl 20',
           '2026-07-02 20:00+00', '2026-07-02 21:00+00', 0, 0, v_user);
  if not (res->>'ok')::boolean then raise exception 'FAIL(2c): booking after teardown buffer rejected: %', res; end if;
  raise notice 'PASS(2): setup/teardown buffer blocks adjacent (19:00 no, 20:00 yes)';

  -- ── Assertion 3: bundle/multi-resource atomicity ────────────────────────────
  -- Make the projector busy, then request [roomA-free-slot, projector-busy].
  res := booking.request_booking(v_church, array[v_proj], null, 'Projektor opptatt',
           '2026-07-03 10:00+00', '2026-07-03 11:00+00', 0, 0, v_user);
  if not (res->>'ok')::boolean then raise exception 'FAIL(3a): projector base booking failed: %', res; end if;

  select count(*) into n_before from booking.booking where church_id = v_church;
  -- roomA is FREE at this time, projector is BUSY → whole request must be rejected
  -- and NOTHING inserted.
  res := booking.request_booking(v_church, array[v_roomA, v_proj], null, 'Bundle',
           '2026-07-03 10:30+00', '2026-07-03 11:30+00', 0, 0, v_user);
  select count(*) into n_after from booking.booking where church_id = v_church;
  if (res->>'ok')::boolean then raise exception 'FAIL(3b): partial-conflict bundle accepted: %', res; end if;
  if n_after <> n_before then
    raise exception 'FAIL(3c): bundle inserted rows despite conflict (% -> %)', n_before, n_after;
  end if;
  -- And roomA must still be free for that window (no orphan hold).
  res := booking.request_booking(v_church, array[v_roomA], null, 'RoomA still free',
           '2026-07-03 10:30+00', '2026-07-03 11:30+00', 0, 0, v_user);
  if not (res->>'ok')::boolean then raise exception 'FAIL(3d): roomA was wrongly held by rolled-back bundle: %', res; end if;
  raise notice 'PASS(3): multi-resource request is all-or-nothing (nothing inserted on partial conflict)';

  -- ── Assertion 4: non-overlap same resource OK; same time diff resource OK ───
  res := booking.request_booking(v_church, array[v_roomA], null, 'Seq 1',
           '2026-07-04 08:00+00', '2026-07-04 09:00+00', 0, 0, v_user);
  if not (res->>'ok')::boolean then raise exception 'FAIL(4a): %', res; end if;
  res := booking.request_booking(v_church, array[v_roomA], null, 'Seq 2 (after)',
           '2026-07-04 09:00+00', '2026-07-04 10:00+00', 0, 0, v_user);
  if not (res->>'ok')::boolean then raise exception 'FAIL(4b): back-to-back rejected: %', res; end if;

  -- same time, different resources
  res := booking.request_booking(v_church, array[v_roomA], null, 'Parallel A',
           '2026-07-05 08:00+00', '2026-07-05 09:00+00', 0, 0, v_user);
  if not (res->>'ok')::boolean then raise exception 'FAIL(4c): %', res; end if;
  res := booking.request_booking(v_church, array[v_roomB], null, 'Parallel B',
           '2026-07-05 08:00+00', '2026-07-05 09:00+00', 0, 0, v_user);
  if not (res->>'ok')::boolean then raise exception 'FAIL(4d): parallel diff-resource rejected: %', res; end if;
  raise notice 'PASS(4): non-overlap same resource OK; same time on different resources OK';

  -- ── Assertion 5: pending may coexist; approve re-checks the constraint ──────
  -- Projektor requires approval? No (false). Use the event_type gate to force
  -- pending: create a requires_approval event_type.
  declare
    v_et uuid;
  begin
    insert into booking.event_type (church_id, name, requires_approval)
      values (v_church, 'krever_godkjenning', true) returning id into v_et;

    res := booking.request_booking(v_church, array[v_roomB], v_et, 'Pending 1',
             '2026-07-06 10:00+00', '2026-07-06 12:00+00', 0, 0, v_user);
    if res->>'status' <> 'pending' then raise exception 'FAIL(5a): not pending: %', res; end if;
    v_bk := (res->>'booking_id')::uuid;

    res := booking.request_booking(v_church, array[v_roomB], v_et, 'Pending 2 (overlap)',
             '2026-07-06 11:00+00', '2026-07-06 13:00+00', 0, 0, v_user);
    if res->>'status' <> 'pending' then raise exception 'FAIL(5b): two overlapping pendings should coexist: %', res; end if;
    v_bk2 := (res->>'booking_id')::uuid;

    -- Approve the first → fine.
    res := booking.approve_booking(v_bk, v_user);
    if not (res->>'ok')::boolean then raise exception 'FAIL(5c): first approve failed: %', res; end if;

    -- Approve the second overlapping one → exclusion constraint must block it.
    res := booking.approve_booking(v_bk2, v_user);
    if (res->>'ok')::boolean then raise exception 'FAIL(5d): second overlapping approve succeeded: %', res; end if;
    if not (res->>'conflict')::boolean then raise exception 'FAIL(5e): expected conflict flag: %', res; end if;
  end;
  raise notice 'PASS(5): pending bookings coexist; approving the 2nd overlap is blocked by exclusion constraint';

  -- ── Assertion 6: cancel/decline frees the slot ──────────────────────────────
  -- Cancel the approved Pending-1 (v_bk) → the still-pending v_bk2 can now approve.
  res := booking.cancel_booking(v_bk, v_user);
  if not (res->>'ok')::boolean then raise exception 'FAIL(6a): cancel failed: %', res; end if;
  res := booking.approve_booking(v_bk2, v_user);
  if not (res->>'ok')::boolean then raise exception 'FAIL(6b): slot not freed after cancel: %', res; end if;
  raise notice 'PASS(6): cancel frees the slot, previously-conflicting booking can be approved';

  raise notice 'fixtures church=% church2=%', v_church, v_church2;
end $$;

-- ── Assertion 7: RLS — anon cannot SELECT another church's bookings ──────────
do $$
declare
  v_other uuid := (select id from public.church where slug = 'annenkirke');
  v_home  uuid := (select id from public.church where slug = 'bookingkirken');
  n int;
begin
  -- Impersonate anon (no membership anywhere). is_member_of() → false for all.
  perform set_config('request.jwt.claims', '{}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('role', 'anon', true);

  select count(*) into n from booking.booking;  -- RLS-filtered to memberships
  if n <> 0 then
    raise exception 'FAIL(7a): anon saw % bookings (RLS leak)', n;
  end if;

  -- Direct write must be denied (no write policy for anon/authenticated).
  begin
    insert into booking.booking (church_id, title, starts_at_utc, ends_at_utc)
      values (v_home, 'hack', now(), now() + interval '1 hour');
    perform set_config('role', 'postgres', true);
    raise exception 'FAIL(7b): anon performed a direct insert';
  exception when insufficient_privilege then
    null; -- expected: no write grant/policy
  end;

  perform set_config('role', 'postgres', true);
  raise notice 'PASS(7): anon sees 0 bookings (RLS) and cannot write directly (RPC-only)';
end $$;

select 'ALL BOOKING-LOGIC TESTS PASSED' as result;
