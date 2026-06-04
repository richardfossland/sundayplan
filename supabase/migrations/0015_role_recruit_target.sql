-- SundayPlan migration 0015 — per-role recruiting target
-- The role-balance report (Phase 12, buildRoleBalanceReport) compares how many
-- ACTIVE qualified members a role has against a desired bench size, so a planner
-- can see at a glance which roles to recruit for. That desired size lives on the
-- role itself.
--
-- DEFAULT NULL = no target → the report shows the role's capacity but no
-- over/under signal (delta/status stay null). Existing behaviour is therefore
-- unchanged: nothing reads this column unless a planner sets it. No new tables;
-- `role` already has read (member) / write (planner) RLS from 0002.

alter table public.role
  add column if not exists recruit_target int;

-- A target is a non-negative head-count; cap it so a typo can't poison the UI.
alter table public.role
  add constraint role_recruit_target_chk
    check (recruit_target is null or (recruit_target >= 0 and recruit_target <= 100));
