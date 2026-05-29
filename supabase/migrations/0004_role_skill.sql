-- 0004_role_skill — a role can demand a minimum skill level.
--
-- The schedule grid shows "needs {skill}" per role, and the conflict engine's
-- skill_gap rule (Phase 4.2 rule 6) compares a member's skill in a role against
-- what the role demands. Both need the requirement on the role itself; until
-- now it lived only in the web mock. Default 'capable' so existing roles get a
-- sensible floor without a data migration.

alter table public.role
  add column skill_required text not null default 'capable'
  check (skill_required in ('training', 'capable', 'lead', 'trainer'));
