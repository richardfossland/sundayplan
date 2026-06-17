-- Security/logic assertions for migrations 0018–0019 (and the fresh-DB story).
-- Runs as a single psql script; any failed assertion raises and aborts.

\set ON_ERROR_STOP on

do $$
declare
  v_church uuid;
  v_user uuid;
  v_requester uuid;
  v_claimer uuid;
  v_service uuid;
  v_team uuid;
  v_role uuid;
  v_assignment uuid;
  v_swap uuid;
  n int;
begin
  -- ── fixtures ────────────────────────────────────────────────────────────────
  insert into auth.users (email) values ('planner@test.no') returning id into v_user;
  insert into public.church (name, slug) values ('Testkirken', 'testkirken') returning id into v_church;
  insert into public.church_settings (church_id) values (v_church);

  insert into public.member (church_id, display_name)
    values (v_church, 'Reidun Requester') returning id into v_requester;
  insert into public.member (church_id, display_name)
    values (v_church, 'Kåre Claimer') returning id into v_claimer;

  insert into public.service (church_id, name, starts_at_utc)
    values (v_church, 'Gudstjeneste', now() + interval '7 days') returning id into v_service;
  insert into public.team (church_id, name)
    values (v_church, 'Teknikk') returning id into v_team;
  insert into public.role (team_id, name)
    values (v_team, 'Lyd') returning id into v_role;
  insert into public.assignment (church_id, service_id, role_id, member_id)
    values (v_church, v_service, v_role, v_requester) returning id into v_assignment;

  -- ── 0018: song_admin is a legal app grant; junk is not ─────────────────────
  insert into public.app_grant (church_id, user_id, app)
    values (v_church, v_user, 'song_admin');
  begin
    insert into public.app_grant (church_id, user_id, app)
      values (v_church, v_user, 'not_an_app');
    raise exception 'FAIL: app_grant accepted an unknown app value';
  exception when check_violation then
    null; -- expected
  end;
  raise notice 'PASS: 0018 song_admin grant accepted, junk rejected';

  -- ── church.locale (0001) is the church-level i18n default ───────────────────
  if (select locale from public.church where id = v_church) <> 'no' then
    raise exception 'FAIL: church.locale default is not no';
  end if;
  raise notice 'PASS: church.locale present with no default (i18n resolution member.language → church.locale → no)';

  -- ── 0019: swap claim policy + identity freeze ───────────────────────────────
  insert into public.swap_request (church_id, assignment_id, requested_by_member_id)
    values (v_church, v_assignment, v_requester) returning id into v_swap;

  -- The freeze trigger blocks repointing identity columns even as superuser.
  begin
    update public.swap_request set requested_by_member_id = v_claimer where id = v_swap;
    raise exception 'FAIL: identity column was mutable';
  exception when others then
    if sqlerrm not like '%immutable%' then raise; end if;
  end;
  raise notice 'PASS: 0019 identity columns frozen by trigger';
end $$;

-- Volunteer-JWT RLS path: claim an open swap as the volunteer (authenticated
-- role + volunteer_member_id claim), then prove a claimed swap is closed.
do $$
declare
  v_church uuid := (select id from public.church limit 1);
  v_swap uuid := (select id from public.swap_request limit 1);
  v_claimer uuid := (select id from public.member where display_name = 'Kåre Claimer');
  v_requester uuid := (select id from public.member where display_name = 'Reidun Requester');
  n int;
begin
  -- Impersonate the claiming volunteer.
  perform set_config('request.jwt.claims', json_build_object('volunteer_member_id', v_claimer)::text, true);
  perform set_config('role', 'authenticated', true);

  -- Legal claim: open → claimed by self.
  update public.swap_request
     set status = 'claimed', claimed_by_member_id = v_claimer
   where id = v_swap;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: legal volunteer claim was blocked'; end if;

  -- A claimed swap is no longer claimable (USING filters it out → 0 rows).
  update public.swap_request
     set status = 'claimed', claimed_by_member_id = v_requester
   where id = v_swap;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: non-open swap was claimable'; end if;

  perform set_config('role', 'postgres', true);
  raise notice 'PASS: 0019 volunteer claim allowed once, closed thereafter';

  -- WITH CHECK: reopen the swap as superuser, then try an illegal claim shape
  -- (claiming on behalf of someone else) — must violate the policy.
  update public.swap_request set status = 'open', claimed_by_member_id = null where id = v_swap;

  perform set_config('request.jwt.claims', json_build_object('volunteer_member_id', v_claimer)::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    update public.swap_request
       set status = 'claimed', claimed_by_member_id = v_requester
     where id = v_swap;
    raise exception 'FAIL: WITH CHECK allowed claiming on behalf of another member';
  exception when others then
    if sqlerrm not like '%row-level security%' then raise; end if;
  end;
  perform set_config('role', 'postgres', true);
  raise notice 'PASS: 0019 WITH CHECK rejects claims for other members';
end $$;

-- 0025: booking write RPCs must be service-role-only. They are SECURITY DEFINER
-- with no internal church/role check, so any client execute grant is a
-- cross-tenant write hole. (Postgres defaults functions to EXECUTE for PUBLIC —
-- the revoke must hit PUBLIC, not just authenticated/anon.)
do $$
begin
  if has_function_privilege('authenticated', 'booking.approve_booking(uuid,uuid)', 'execute') then
    raise exception 'FAIL: authenticated can execute booking.approve_booking (cross-tenant hole)';
  end if;
  if has_function_privilege('anon', 'booking.approve_booking(uuid,uuid)', 'execute') then
    raise exception 'FAIL: anon can execute booking.approve_booking';
  end if;
  if not has_function_privilege('service_role', 'booking.approve_booking(uuid,uuid)', 'execute') then
    raise exception 'FAIL: service_role lost execute on booking.approve_booking (app would break)';
  end if;
  raise notice 'PASS: 0025 booking write RPCs are service-role-only';
end $$;

select 'ALL SECURITY-LOGIC TESTS PASSED' as result;
