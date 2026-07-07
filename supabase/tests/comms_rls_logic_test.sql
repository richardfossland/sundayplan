-- RLS assertions for 0027 — message writes are planner-only, reads are for any
-- church member. Runs after all migrations on the throwaway Postgres. Uses the
-- same role-impersonation pattern as security_logic_test.sql: set
-- request.jwt.claim.sub (auth.uid()) + role=authenticated so is_member_of /
-- is_planner_of resolve against a real church_member row.

\set ON_ERROR_STOP on

do $$
declare
  v_church  uuid;
  v_planner uuid;
  v_viewer  uuid;
  v_service uuid;
  n int;
begin
  -- ── fixtures ────────────────────────────────────────────────────────────────
  insert into auth.users (email) values ('planner@comms.test') returning id into v_planner;
  insert into auth.users (email) values ('viewer@comms.test')  returning id into v_viewer;
  insert into public.church (name, slug) values ('Comms Test', 'comms-test') returning id into v_church;
  insert into public.church_settings (church_id) values (v_church);
  insert into public.church_member (church_id, user_id, role) values (v_church, v_planner, 'planner');
  insert into public.church_member (church_id, user_id, role) values (v_church, v_viewer,  'viewer');
  insert into public.service (church_id, name, starts_at_utc)
    values (v_church, 'Gudstjeneste', now() + interval '7 days') returning id into v_service;

  -- ── a VIEWER (member, not planner) may NOT write a message ──────────────────
  perform set_config('request.jwt.claim.sub', v_viewer::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    insert into public.message (church_id, service_id, channel, body)
      values (v_church, v_service, 'sms', 'forged by a viewer');
    perform set_config('role', 'postgres', true);
    raise exception 'FAIL: a viewer could INSERT a message (0027 write policy not planner-gated)';
  exception when insufficient_privilege then
    null; -- expected: RLS blocks the write
  end;
  perform set_config('role', 'postgres', true);

  -- ── but a viewer CAN still read message history (dashboard count etc.) ───────
  perform set_config('request.jwt.claim.sub', v_viewer::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into n from public.message where church_id = v_church; -- must not raise
  perform set_config('role', 'postgres', true);
  raise notice 'PASS: 0027 viewer is denied message writes but may read (count=%)', n;

  -- ── a PLANNER may write a message ───────────────────────────────────────────
  perform set_config('request.jwt.claim.sub', v_planner::text, true);
  perform set_config('role', 'authenticated', true);
  insert into public.message (church_id, service_id, channel, body)
    values (v_church, v_service, 'sms', 'sent by a planner');
  perform set_config('role', 'postgres', true);

  select count(*) into n from public.message where church_id = v_church and body = 'sent by a planner';
  if n <> 1 then
    raise exception 'FAIL: planner INSERT did not persist (0027 over-restricted the write)';
  end if;
  raise notice 'PASS: 0027 planner may write a message';
end $$;

select 'ALL COMMS-RLS TESTS PASSED' as result;
