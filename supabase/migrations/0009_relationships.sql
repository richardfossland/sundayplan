-- SundayPlan migration 0009 — relationships for conflict rules 5 & 9
-- Two long-deferred conflict rules needed schema support:
--   rule 5 family_conflict        → a way to group members into a household
--   rule 9 key_person_unavailable → a "designated lead" marker per (member, role)
-- Both are lightweight, additive columns on existing tables; no RLS changes are
-- needed because each column inherits its table's existing member/planner
-- policies (member_*, team_membership_*).

-- A free-text household label (e.g. "Hansen") groups members the planner would
-- rather not schedule into the same service at once. Kept as a label, not a
-- separate table, so it needs no extra CRUD; grouping is per church.
alter table public.member
  add column if not exists household text;
create index if not exists member_household_idx
  on public.member (church_id, household) where household is not null;

-- Marks a member as a designated lead for a role. Rule 9 warns when every key
-- person for a required role is unavailable for a service.
alter table public.team_membership
  add column if not exists is_key_person boolean not null default false;
