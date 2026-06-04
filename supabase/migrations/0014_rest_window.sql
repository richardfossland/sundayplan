-- SundayPlan migration 0014 — hard rest-window between assignments
-- The consecutive-Sundays rule (0008) is a SOFT burnout heuristic counted only
-- on Sundays. Some churches want a HARD minimum gap (in days) between ANY two of
-- a volunteer's assignments — e.g. "never serve twice within 6 days". This adds
-- that knob on church_settings; the conflict engine (rule 11, ruleMinRestWindow)
-- and the auto-fill orchestrator both read it.
--
-- DEFAULT 0 = OFF. With 0 the rule never fires and auto-fill is unchanged, so
-- this migration is behaviour-preserving for every existing church. No new
-- tables / RLS — church_settings already has read (member) / write (planner).

alter table public.church_settings
  add column if not exists min_rest_days int not null default 0;

-- Keep it sane: 0 (off) through a full quarter. A larger window is almost
-- certainly a misconfiguration that would make scheduling impossible.
alter table public.church_settings
  add constraint church_settings_min_rest_days_chk
    check (min_rest_days between 0 and 90);
