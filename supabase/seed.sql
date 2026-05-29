-- SundayPlan local seed — "Alta Frikirke" demo data.
-- Mirrors the web app's mock church (apps/web/lib/mock.ts) so local dev shows
-- the same scenario the engines were tuned against. Loaded by `supabase db
-- reset` / `supabase start`. Account-bound rows (church_member, user_profile)
-- are omitted — they need real auth.users; member.user_id stays null.

-- ── Church ────────────────────────────────────────────────────────────────
insert into public.church (id, name, slug, plan_tier, locale, timezone, denomination) values
  ('c0000000-0000-4000-8000-000000000001', 'Alta Frikirke', 'alta-frikirke', 'growth', 'no', 'Europe/Oslo', 'Frikirken');

insert into public.church_settings (church_id, tono_license_status, ccli_size_category, default_max_assignments_per_month) values
  ('c0000000-0000-4000-8000-000000000001', 'direct_agreement', 'B', 3);

-- ── Members ──────────────────────────────────────────────────────────────
insert into public.member (id, church_id, display_name, phone_e164, email, language, preferred_channel, status, joined_at, target_serves_per_month) values
  ('a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'Maria Hansen', '+4791000001', null,            'no', 'sms',   'active',   '2019-02-01', 2),
  ('a0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001', 'Ingrid Berg',  '+4791000002', null,            'no', 'sms',   'active',   '2020-09-12', 2),
  ('a0000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000001', 'Erik Dahl',    null,          'erik@x.no',     'no', 'email', 'active',   '2021-05-20', 2),
  ('a0000000-0000-4000-8000-000000000004', 'c0000000-0000-4000-8000-000000000001', 'Lars Olsen',   '+4791000004', null,            'no', 'sms',   'active',   '2018-11-03', 2),
  ('a0000000-0000-4000-8000-000000000005', 'c0000000-0000-4000-8000-000000000001', 'Sofie Lund',   '+4791000005', null,            'no', 'push',  'inactive', '2022-01-15', 2),
  ('a0000000-0000-4000-8000-000000000006', 'c0000000-0000-4000-8000-000000000001', 'Jonas Vik',    '+4791000006', null,            'no', 'sms',   'active',   '2024-08-01', 1);

-- ── Teams ──────────────────────────────────────────────────────────────────
insert into public.team (id, church_id, name, color, description) values
  ('b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'Worship',     '#D4A017', 'Music — vocals, band, and leading the congregation.'),
  ('b0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001', 'Tech',        '#2B5CB8', 'Sound, slides, and the live stream.'),
  ('b0000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000001', 'Hospitality', '#3FA34D', 'Welcome, coffee, and connect.');

-- ── Roles ──────────────────────────────────────────────────────────────────
insert into public.role (id, team_id, name) values
  ('d0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'Lead vocal'),
  ('d0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', 'Keys'),
  ('d0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000001', 'Drums'),
  ('d0000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-000000000001', 'Lead guitar'),
  ('d0000000-0000-4000-8000-000000000005', 'b0000000-0000-4000-8000-000000000002', 'Sound'),
  ('d0000000-0000-4000-8000-000000000006', 'b0000000-0000-4000-8000-000000000003', 'Greeter');

-- ── Team memberships (member ↔ role, with skill) ────────────────────────────
insert into public.team_membership (member_id, team_id, role_id, skill_level) values
  ('a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'lead'),
  ('a0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'capable'),
  ('a0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000002', 'lead'),
  ('a0000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000003', 'capable'),
  ('a0000000-0000-4000-8000-000000000006', 'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000004', 'training'),
  ('a0000000-0000-4000-8000-000000000005', 'b0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000005', 'capable'),
  ('a0000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000005', 'capable'),
  ('a0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000005', 'capable');

-- ── Services (the four June Sundays from the rota) ──────────────────────────
insert into public.service (id, church_id, name, starts_at_utc, state) values
  ('e0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'Sunday 7 June',  '2026-06-07T09:00:00Z', 'published'),
  ('e0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001', 'Sunday 14 June', '2026-06-14T09:00:00Z', 'published'),
  ('e0000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000001', 'Sunday 21 June', '2026-06-21T09:00:00Z', 'draft'),
  ('e0000000-0000-4000-8000-000000000004', 'c0000000-0000-4000-8000-000000000001', 'Sunday 28 June', '2026-06-28T09:00:00Z', 'draft');

-- ── A few assignments on the first service ──────────────────────────────────
insert into public.assignment (church_id, service_id, role_id, member_id, status, created_by) values
  ('c0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'accepted', 'planner'),
  ('c0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', 'accepted', 'planner'),
  ('c0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000004', 'accepted', 'planner'),
  ('c0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000006', 'pending',  'auto_fill');

-- ── Demo planner login (local only) ─────────────────────────────────────────
-- A confirmed email user that is admin of Alta Frikirke, so a fresh `db reset`
-- gives a working sign-in (planner@alta.test / planner123) that sees real data.
-- NB: the token columns must be '' (empty string), never NULL — GoTrue scans
-- them into a Go `string`, and a NULL makes every auth query fail with
-- "Database error querying schema" (confirmation_token scan error).
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change, email_change_token_new
) values (
  '00000000-0000-0000-0000-000000000000',
  'f0000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'planner@alta.test',
  crypt('planner123', gen_salt('bf')),
  now(), now(), now(),
  '{"provider":"email","providers":["email"]}', '{}',
  '', '', '', ''
);

insert into auth.identities (
  id, user_id, provider_id, identity_data, provider, created_at, updated_at, last_sign_in_at
) values (
  gen_random_uuid(),
  'f0000000-0000-4000-8000-000000000001',
  'f0000000-0000-4000-8000-000000000001',
  '{"sub":"f0000000-0000-4000-8000-000000000001","email":"planner@alta.test"}',
  'email', now(), now(), now()
);

insert into public.user_profile (id, display_name) values
  ('f0000000-0000-4000-8000-000000000001', 'Alta Planner');

insert into public.church_member (church_id, user_id, role) values
  ('c0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001', 'admin');
