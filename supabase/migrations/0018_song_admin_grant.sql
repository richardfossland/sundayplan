-- 0018 — `song_admin` as a reserved app value in app_grant.
--
-- SundaySong's /v1/admin/* surface needs a real authorization model (audit
-- 2026-06-10: any valid Sunday JWT could moderate). The decision: no new JWT
-- claim and no hook change — the 0010 custom_access_token_hook already stamps
-- EVERY app_grant row into the `app_grants` claim, so a reserved value rides
-- the existing pipeline end to end. SundaySong's middleware then requires
-- `app_grants[<church_id>]` to contain 'song_admin'.
--
-- Planners manage grants through the existing app_grant_planner_manage policy;
-- nothing else changes.

alter table public.app_grant
  drop constraint if exists app_grant_app_check;

alter table public.app_grant
  add constraint app_grant_app_check
  check (app in ('plan','stage','rec','song','edit','studio','paper','song_admin'));
