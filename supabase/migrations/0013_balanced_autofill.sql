-- SundayPlan migration 0013 — global-fairness auto-fill settings
-- The auto-fill orchestrator gained a balanced path (balancedAutoFill in the
-- SDK) that flattens volunteer load across the whole planning window after the
-- greedy pass — the #1 burnout-reduction lever. Surface its controls per church
-- so the schedule page can offer it without changing anyone's current outcome.
--
-- Defaults preserve EXISTING behaviour: balanced auto-fill is OFF, so the
-- greedy `autoFillSchedule` remains the default. The epsilon mirrors the SDK's
-- DEFAULT_BALANCE_EPSILON (2.0) — the most relevance a flattening swap may cost.
-- church_settings already has read (member) / write (planner) RLS; no new
-- tables or policies.

alter table public.church_settings
  add column if not exists balanced_autofill_enabled boolean not null default false,
  add column if not exists balanced_autofill_epsilon  numeric(4,1) not null default 2.0;

-- Keep the epsilon in a sane band: 0 = "only score-neutral/improving swaps",
-- and a generous ceiling so a planner can trade some fit for fairness, but not
-- so high that auto-fill would scatter assignments onto poor matches.
alter table public.church_settings
  add constraint church_settings_balanced_autofill_epsilon_chk
    check (balanced_autofill_epsilon between 0 and 40);
