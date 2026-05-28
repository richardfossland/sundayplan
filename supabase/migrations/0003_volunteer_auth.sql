-- SundayPlan migration 0003 — volunteer (magic-link) RLS + lock down magic_link
--
-- Volunteers never have an account. The magic-link Edge Function mints a short
-- Supabase JWT carrying a custom claim `volunteer_member_id`; these policies
-- scope such a session to that one member's own data. The planner policies from
-- 0002 remain and are additive (Postgres ORs permissive policies together), so
-- a planner session is unaffected.

-- Lock down magic_link: enabling RLS with NO policy means only the service_role
-- (which bypasses RLS) can touch it. Tokens are never read by clients directly.
alter table public.magic_link enable row level security;

-- The volunteer_member_id claim from the current JWT, or NULL when absent
-- (planner/anon/service sessions). NULL never equals a real member id, so the
-- volunteer policies below simply contribute no rows for non-volunteer sessions.
create or replace function public.volunteer_member_id()
returns uuid
language sql
stable
as $$
  select nullif(auth.jwt() ->> 'volunteer_member_id', '')::uuid;
$$;

-- A volunteer may read their own assignments…
create policy assignment_volunteer_read on public.assignment
  for select using (member_id = public.volunteer_member_id());

-- …and respond to them (accept/decline). Scoped to self; the Edge Function is
-- responsible for restricting WHICH columns may change (status/responded_at).
create policy assignment_volunteer_update on public.assignment
  for update using (member_id = public.volunteer_member_id());

-- A volunteer may read + manage their own availability.
create policy availability_volunteer_all on public.availability
  for all using (member_id = public.volunteer_member_id());

-- A volunteer may read the services they're assigned to (context on the
-- response page).
create policy service_volunteer_read on public.service
  for select using (
    exists (
      select 1 from public.assignment a
      where a.service_id = service.id
        and a.member_id = public.volunteer_member_id()
    )
  );

-- …and their own member row.
create policy member_volunteer_self_read on public.member
  for select using (id = public.volunteer_member_id());
