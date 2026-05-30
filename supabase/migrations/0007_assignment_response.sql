-- ════════════════════════════════════════════════════════════════════════════
-- 0007_assignment_response.sql — Magic-link volunteer response (Phase 7)
--
-- The no-account RSVP loop reuses the existing `assignment` columns for the
-- state transition (`status`, `responded_at`) and the `magic_link` table for
-- single-use/replay tracking (both from 0002). The volunteer RLS in 0003 already
-- lets a magic-link session read + update its own assignment.
--
-- The one thing the schema is missing is somewhere to keep the optional short
-- note a volunteer can leave when they accept or decline ("running 10 min late",
-- "sorry, away that weekend"). We add it here.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.assignment
  add column if not exists response_note text;

-- A volunteer's note is part of their own response, so it's covered by the
-- existing assignment_volunteer_update policy (0003) and assignment_planner_all
-- (0002). No new policy needed — the column rides the row's existing RLS.

comment on column public.assignment.response_note is
  'Optional short note a volunteer leaves with their magic-link accept/decline (Phase 7).';
