-- SundayPlan migration 0008 — conflict-config on church settings
-- The conflict engine (Phase 4.2) has tunable thresholds that were hard-coded
-- to DEFAULT_CONFLICT_CONFIG in the SDK. Surface them per church so the
-- settings page (Phase 4.3) can drive them. No new tables, no RLS changes —
-- church_settings already has read (member) / write (planner) policies.

alter table public.church_settings
  add column if not exists unfilled_warn_days      int not null default 7,
  add column if not exists max_consecutive_sundays int not null default 3;

-- Opt-in: mint strict one-shot response links (a tap consumes the link) instead
-- of the default reusable change-of-mind links. Enforced in the respond path.
alter table public.church_settings
  add column if not exists single_use_response_links boolean not null default false;

-- Keep thresholds sane (a 0 would make the rules either never or always fire).
alter table public.church_settings
  add constraint church_settings_unfilled_warn_days_chk
    check (unfilled_warn_days between 1 and 60),
  add constraint church_settings_max_consecutive_sundays_chk
    check (max_consecutive_sundays between 1 and 52);
