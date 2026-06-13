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

-- ── Assertion 8: signage view + signage_board (migration 0023) ───────────────
do $$
declare
  v_church uuid := (select id from public.church where slug = 'bookingkirken');
  v_room   uuid := (select id from booking.resource where church_id = v_church and name = 'Storsalen');
  v_now    timestamptz := '2026-05-18T13:00:00Z';
  v_cur    uuid;  -- a booking running AT v_now, flagged for signage
  v_next   uuid;  -- a later booking, flagged for signage
  v_hidden uuid;  -- approved but NOT flagged → must be excluded
  res      jsonb;
  board    jsonb;
  n        int;
begin
  -- Current booking 12:00–14:00 on Storsalen (no-approval resource → approved).
  res := booking.request_booking(v_church, array[v_room], null, 'Bryllup',
           '2026-05-18T12:00:00Z', '2026-05-18T14:00:00Z', 0, 0, null);
  v_cur := (res->>'booking_id')::uuid;
  update booking.booking set show_on_signage = true where id = v_cur;

  -- Next booking 19:00–20:00, flagged.
  res := booking.request_booking(v_church, array[v_room], null, 'Korøvelse',
           '2026-05-18T19:00:00Z', '2026-05-18T20:00:00Z', 0, 0, null);
  v_next := (res->>'booking_id')::uuid;
  update booking.booking set show_on_signage = true where id = v_next;

  -- A NOT-flagged approved booking on the next day → must never appear.
  res := booking.request_booking(v_church, array[v_room], null, 'Skjult',
           '2026-05-19T10:00:00Z', '2026-05-19T11:00:00Z', 0, 0, null);
  v_hidden := (res->>'booking_id')::uuid;  -- show_on_signage stays false (default)

  -- View shows the two flagged ones, not the hidden one.
  select count(*) into n from booking.displayable
   where church_id = v_church and booking_id in (v_cur, v_next, v_hidden);
  if n <> 2 then
    raise exception 'FAIL(8a): displayable returned % flagged rows (expected 2)', n;
  end if;
  if exists (select 1 from booking.displayable where booking_id = v_hidden) then
    raise exception 'FAIL(8b): an unflagged booking leaked into displayable';
  end if;

  -- The view resolves the room as the location.
  if not exists (
    select 1 from booking.displayable
     where booking_id = v_cur and resource_id = v_room and resource_name = 'Storsalen'
  ) then
    raise exception 'FAIL(8c): displayable did not resolve the room location';
  end if;

  -- signage_board: now=13:00 → Storsalen current=Bryllup, next=Korøvelse.
  board := booking.signage_board(v_church, v_now);
  if jsonb_array_length(board) < 1 then
    raise exception 'FAIL(8d): signage_board returned no rooms';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(board) e
     where e->>'resource_name' = 'Storsalen'
       and e->'current'->>'title' = 'Bryllup'
       and e->'next'->>'title' = 'Korøvelse'
  ) then
    raise exception 'FAIL(8e): signage_board now/next wrong: %', board;
  end if;

  raise notice 'PASS(8): signage view + board show only flagged approved bookings with now/next';
end $$;

-- ── Assertion 9: rental monetization (migration 0024) ─────────────────────────
do $$
declare
  v_church uuid;
  v_room   uuid;
  v_bk     uuid;
  res      jsonb;
  r        jsonb;
  v_acc    timestamptz;
begin
  insert into public.church (name, slug) values ('Leiekirken', 'leiekirken') returning id into v_church;

  -- A priced, public room with a deposit % and cancellation policy.
  insert into booking.resource (church_id, kind, name, requires_approval,
                                rental_price_nok, deposit_pct, cancellation_policy)
    values (v_church, 'room', 'Festsalen', false, 2500.00, 20,
            'Gratis avbestilling inntil 14 dager før.')
    returning id into v_room;

  -- Booking lands approved (requires_approval=false); payment_status defaults 'none'.
  res := booking.request_booking(v_church, array[v_room], null, 'Bryllup — Kari',
           '2026-08-01 12:00+00', '2026-08-01 18:00+00', 0, 0, null, 'Kari', 'kari@test.no');
  if not (res->>'ok')::boolean then
    raise exception 'FAIL(9a): rental booking not created: %', res;
  end if;
  v_bk := (res->>'booking_id')::uuid;
  if (select payment_status from booking.booking where id = v_bk) <> 'none' then
    raise exception 'FAIL(9b): payment_status default is not none';
  end if;

  -- capture_rental_agreement freezes a snapshot + html.
  r := booking.capture_rental_agreement(
         v_bk, v_church,
         jsonb_build_object('price_nok', 2500, 'deposit_pct', 20),
         '<html>Leieavtale</html>');
  if not (r->>'ok')::boolean then
    raise exception 'FAIL(9c): capture_rental_agreement failed: %', r;
  end if;
  if (select count(*) from booking.rental_agreement where booking_id = v_bk) <> 1 then
    raise exception 'FAIL(9d): rental_agreement row not created';
  end if;

  -- Re-capture before acceptance updates the snapshot (idempotent path).
  r := booking.capture_rental_agreement(
         v_bk, v_church, jsonb_build_object('price_nok', 2500, 'v', 2), '<html>v2</html>');
  if (select agreement_html from booking.rental_agreement where booking_id = v_bk) <> '<html>v2</html>' then
    raise exception 'FAIL(9e): re-capture did not update html before acceptance';
  end if;

  -- set_payment_status flips to deposit_pending + records reference.
  r := booking.set_payment_status(v_bk, v_church, 'deposit_pending', 'stub-ref-1');
  if not (r->>'ok')::boolean then
    raise exception 'FAIL(9f): set_payment_status failed: %', r;
  end if;
  if (select payment_status from booking.booking where id = v_bk) <> 'deposit_pending'
     or (select payment_reference from booking.booking where id = v_bk) <> 'stub-ref-1' then
    raise exception 'FAIL(9g): payment_status / reference not set';
  end if;

  -- Invalid payment status is rejected by the RPC (and the column check).
  r := booking.set_payment_status(v_bk, v_church, 'bananas');
  if (r->>'ok')::boolean then
    raise exception 'FAIL(9h): invalid payment status accepted';
  end if;

  -- accept_rental_agreement records acceptance + jti once.
  r := booking.accept_rental_agreement(v_bk, v_church, 'jti-abc');
  if not (r->>'ok')::boolean or (r->>'already')::boolean then
    raise exception 'FAIL(9i): first acceptance not recorded: %', r;
  end if;
  select accepted_at into v_acc from booking.rental_agreement where booking_id = v_bk;
  if v_acc is null then
    raise exception 'FAIL(9j): accepted_at not set';
  end if;
  if (select accepted_token_jti from booking.rental_agreement where booking_id = v_bk) <> 'jti-abc' then
    raise exception 'FAIL(9k): accepted_token_jti not recorded';
  end if;

  -- Re-acceptance is idempotent (already=true) and does NOT change accepted_at.
  r := booking.accept_rental_agreement(v_bk, v_church, 'jti-other');
  if not (r->>'ok')::boolean or not (r->>'already')::boolean then
    raise exception 'FAIL(9l): re-acceptance not idempotent: %', r;
  end if;
  if (select accepted_token_jti from booking.rental_agreement where booking_id = v_bk) <> 'jti-abc' then
    raise exception 'FAIL(9m): re-acceptance overwrote the jti';
  end if;

  -- Re-capture AFTER acceptance must NOT clobber the frozen agreement html.
  r := booking.capture_rental_agreement(v_bk, v_church, jsonb_build_object('v', 3), '<html>v3</html>');
  if (select agreement_html from booking.rental_agreement where booking_id = v_bk) <> '<html>v2</html>' then
    raise exception 'FAIL(9n): re-capture overwrote an accepted agreement';
  end if;

  -- Refund flow.
  r := booking.set_payment_status(v_bk, v_church, 'refunded');
  if (select payment_status from booking.booking where id = v_bk) <> 'refunded' then
    raise exception 'FAIL(9o): refund not applied';
  end if;

  -- deposit_pct range check rejects > 100.
  begin
    insert into booking.resource (church_id, kind, name, deposit_pct)
      values (v_church, 'room', 'Ulovlig', 150);
    raise exception 'FAIL(9p): deposit_pct > 100 was accepted';
  exception when check_violation then
    null;  -- expected
  end;

  raise notice 'PASS(9): rental fields + agreement snapshot/acceptance + payment_status lifecycle';
end $$;

-- ── Assertion 10: signage does NOT leak renter PII (external rental title) ─────
-- An external rental's booking.title embeds the renter name (e.g.
-- "Bryllup — Ola Nordmann"). The PUBLIC signage view/board must replace it with a
-- non-PII label (event-type name, else 'Privat arrangement').
do $$
declare
  v_church uuid := (select id from public.church where slug = 'bookingkirken');
  v_room   uuid := (select id from booking.resource where church_id = v_church and name = 'Lillesalen');
  v_now    timestamptz := '2026-07-10T13:00:00Z';
  v_et     uuid;
  res      jsonb;
  v_bk     uuid;
  v_title  text;
  board    jsonb;
begin
  if v_room is null then
    insert into booking.resource (church_id, kind, name, bookable_by, requires_approval, status)
      values (v_church, 'room', 'Lillesalen', 'public', false, 'active')
      returning id into v_room;
  end if;
  insert into booking.event_type (church_id, name, requires_approval)
    values (v_church, 'Bryllup-signage', false) returning id into v_et;

  -- External rental: renter_name set, title embeds the renter PII.
  res := booking.request_booking(v_church, array[v_room], v_et,
           'Bryllup — Ola Nordmann', '2026-07-10T12:00:00Z', '2026-07-10T14:00:00Z',
           0, 0, null, 'Ola Nordmann', 'ola@example.com');
  v_bk := (res->>'booking_id')::uuid;
  update booking.booking set show_on_signage = true where id = v_bk;

  -- The view's title must NOT contain the renter name.
  select title into v_title from booking.displayable where booking_id = v_bk;
  if v_title is null or position('Ola Nordmann' in v_title) > 0 then
    raise exception 'FAIL(10a): signage view leaked renter PII in title: %', v_title;
  end if;
  if v_title <> 'Bryllup-signage' then
    raise exception 'FAIL(10b): expected event-type label, got: %', v_title;
  end if;

  -- The board (what the public feed serves) must not contain the renter name.
  board := booking.signage_board(v_church, v_now);
  if position('Ola Nordmann' in board::text) > 0 then
    raise exception 'FAIL(10c): signage_board leaked renter PII: %', board;
  end if;

  -- An INTERNAL booking (no renter) keeps its real title.
  res := booking.request_booking(v_church, array[v_room], null,
           'Internt møte', '2026-07-11T12:00:00Z', '2026-07-11T14:00:00Z', 0, 0, null);
  update booking.booking set show_on_signage = true where id = (res->>'booking_id')::uuid;
  select title into v_title from booking.displayable where booking_id = (res->>'booking_id')::uuid;
  if v_title <> 'Internt møte' then
    raise exception 'FAIL(10d): internal booking title was altered: %', v_title;
  end if;

  raise notice 'PASS(10): signage title is PII-safe for external rentals, intact for internal bookings';
end $$;

-- ── Assertion 11: RLS — anon cannot read rental_agreement (renter PII) ─────────
do $$
declare
  v_church uuid := (select id from public.church where slug = 'bookingkirken');
  v_room   uuid := (select id from booking.resource where church_id = v_church and name = 'Lillesalen' limit 1);
  res      jsonb;
  v_bk     uuid;
  r        jsonb;
  n        int;
begin
  res := booking.request_booking(v_church, array[v_room], null,
           'Privat — Kari Nordmann', '2026-08-01T12:00:00Z', '2026-08-01T14:00:00Z',
           0, 0, null, 'Kari Nordmann', 'kari@example.com');
  v_bk := (res->>'booking_id')::uuid;
  r := booking.capture_rental_agreement(v_bk, v_church,
         jsonb_build_object('renter', 'Kari Nordmann'), '<html>kontrakt</html>');
  if not (r->>'ok')::boolean then
    raise exception 'FAIL(11a): could not capture agreement: %', r;
  end if;

  -- Anon (no membership) must see ZERO agreements (RLS = is_member_of).
  perform set_config('request.jwt.claims', '{}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('role', 'anon', true);
  select count(*) into n from booking.rental_agreement;
  perform set_config('role', 'postgres', true);
  if n <> 0 then
    raise exception 'FAIL(11b): anon read % rental_agreement rows (PII leak)', n;
  end if;

  raise notice 'PASS(11): anon cannot read rental_agreement (renter PII stays member-only)';
end $$;

select 'ALL BOOKING-LOGIC TESTS PASSED' as result;
