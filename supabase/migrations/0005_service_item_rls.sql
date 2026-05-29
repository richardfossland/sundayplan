-- 0005_service_item_rls
-- Close an RLS gap: service_item, template_item, and service_team_requirement
-- were created in 0002 WITHOUT enabling row level security and WITHOUT policies.
-- Unlike every other tenant table, that left them readable AND writable by any
-- authenticated (or anon) client — a cross-church data leak waiting to happen.
--
-- None of these tables carry church_id; they hang off a parent that does
-- (service / service_template). So we scope each policy through the parent,
-- the same shape as role/team_membership in 0002.

-- ── service_item → service.church_id ─────────────────────────────────────────
alter table public.service_item enable row level security;
create policy service_item_read on public.service_item for select
  using (exists (
    select 1 from public.service s
    where s.id = service_item.service_id and is_member_of(s.church_id)
  ));
create policy service_item_planner_all on public.service_item for all
  using (exists (
    select 1 from public.service s
    where s.id = service_item.service_id and is_planner_of(s.church_id)
  ));

-- ── template_item → service_template.church_id ───────────────────────────────
alter table public.template_item enable row level security;
create policy template_item_read on public.template_item for select
  using (exists (
    select 1 from public.service_template t
    where t.id = template_item.template_id and is_member_of(t.church_id)
  ));
create policy template_item_planner_all on public.template_item for all
  using (exists (
    select 1 from public.service_template t
    where t.id = template_item.template_id and is_planner_of(t.church_id)
  ));

-- ── service_team_requirement → service_template.church_id ────────────────────
alter table public.service_team_requirement enable row level security;
create policy svc_team_req_read on public.service_team_requirement for select
  using (exists (
    select 1 from public.service_template t
    where t.id = service_team_requirement.template_id and is_member_of(t.church_id)
  ));
create policy svc_team_req_planner_all on public.service_team_requirement for all
  using (exists (
    select 1 from public.service_template t
    where t.id = service_team_requirement.template_id and is_planner_of(t.church_id)
  ));
