-- 0019 — tighten the volunteer swap-claim policy (audit 2026-06-10 §2a).
--
-- The old swap_volunteer_claim policy allowed UPDATE of ANY swap in the
-- volunteer's church with no WITH CHECK and no status guard: a volunteer could
-- edit closed swaps, reopen a claimed one, or claim on someone else's behalf.
--
-- New contract, enforced in RLS (not just server code):
--   * only OPEN swaps are claimable (USING),
--   * the resulting row must be 'claimed' BY THE CALLER, in the same church
--     (WITH CHECK — RLS cannot see the OLD row, so identity columns are
--     frozen by a trigger below instead).
-- Planner/requester flows are unaffected (their own policies cover them), and
-- the current web claim flow runs service-role (bypasses RLS) — this hardens
-- the volunteer-JWT path the policies document for mobile.

-- The browse policy must ALSO show a volunteer the swaps they have claimed:
-- Postgres enforces SELECT-policy visibility on the NEW row of any UPDATE
-- that reads the table (a claim is `... where id = X and status='open'`), so
-- with an open-only browse policy every legal claim would be rejected the
-- moment it succeeded (new row invisible). Discovered by the test in
-- supabase/tests/security_logic_test.sql.
drop policy if exists swap_volunteer_browse on public.swap_request;

create policy swap_volunteer_browse on public.swap_request
  for select using (
    (
      status = 'open'
      and church_id = (
        select m.church_id from public.member m where m.id = public.volunteer_member_id()
      )
    )
    or claimed_by_member_id = public.volunteer_member_id()
  );

drop policy if exists swap_volunteer_claim on public.swap_request;

create policy swap_volunteer_claim on public.swap_request
  for update
  using (
    status = 'open'
    and church_id = (
      select m.church_id from public.member m where m.id = public.volunteer_member_id()
    )
  )
  with check (
    status = 'claimed'
    and claimed_by_member_id = public.volunteer_member_id()
    and church_id = (
      select m.church_id from public.member m where m.id = public.volunteer_member_id()
    )
  );

-- Identity columns are immutable for everyone (RLS WITH CHECK cannot compare
-- against OLD, and not even a planner has a legitimate reason to repoint a
-- swap at another assignment/requester/church after creation).
create or replace function public.swap_request_freeze_identity()
returns trigger
language plpgsql
as $$
begin
  if new.church_id               is distinct from old.church_id
     or new.assignment_id        is distinct from old.assignment_id
     or new.requested_by_member_id is distinct from old.requested_by_member_id then
    raise exception 'swap_request identity columns are immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists swap_request_freeze_identity on public.swap_request;
create trigger swap_request_freeze_identity
  before update on public.swap_request
  for each row execute function public.swap_request_freeze_identity();
