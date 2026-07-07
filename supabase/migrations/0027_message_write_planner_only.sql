-- 0027 — restrict message writes to planners (audit 2026-07-06).
--
-- 0006 gave message / message_template / message_delivery a single `for all`
-- policy gated on is_member_of. Every OTHER write in the schema uses
-- is_planner_of — so this let any church_member (incl. a `team_lead` or
-- `viewer`) INSERT/UPDATE/DELETE message + delivery history directly via
-- PostgREST: forge or tamper the comms audit trail, or fabricate delivery rows.
--
-- Split each into: members may SELECT (read history — e.g. the dashboard's
-- message count), only planners (admin/planner) may write. The `for all`
-- planner policy also permits SELECT for planners, which the member SELECT
-- policy already covers (permissive policies OR together), so reads are
-- unchanged for everyone; only INSERT/UPDATE/DELETE narrow to planners.
--
-- Idempotent: drops both the old `_rw` names and the new names before creating,
-- so the migration harness can re-apply it (Postgres has no CREATE POLICY IF
-- NOT EXISTS). The message_delivery_volunteer_select policy from 0006 is left
-- untouched (additive).

-- ── message_template ──────────────────────────────────────────────────────────
drop policy if exists message_template_rw    on message_template;
drop policy if exists message_template_read  on message_template;
drop policy if exists message_template_write on message_template;
create policy message_template_read on message_template
  for select using (is_member_of(church_id));
create policy message_template_write on message_template
  for all using (is_planner_of(church_id)) with check (is_planner_of(church_id));

-- ── message ───────────────────────────────────────────────────────────────────
drop policy if exists message_rw    on message;
drop policy if exists message_read  on message;
drop policy if exists message_write on message;
create policy message_read on message
  for select using (is_member_of(church_id));
create policy message_write on message
  for all using (is_planner_of(church_id)) with check (is_planner_of(church_id));

-- ── message_delivery ──────────────────────────────────────────────────────────
drop policy if exists message_delivery_rw    on message_delivery;
drop policy if exists message_delivery_read  on message_delivery;
drop policy if exists message_delivery_write on message_delivery;
create policy message_delivery_read on message_delivery
  for select using (is_member_of(church_id));
create policy message_delivery_write on message_delivery
  for all using (is_planner_of(church_id)) with check (is_planner_of(church_id));
