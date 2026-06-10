-- 0017_setlist_rls
-- Close an RLS gap: setlist and setlist_song were created in 0002 WITHOUT
-- enabling row level security and WITHOUT policies. Unlike every other tenant
-- table, that left them readable AND writable by any authenticated client —
-- including no-account volunteers, who hold a real Supabase JWT session (0003).
-- setlist is church-scoped service data (one row per service) and is read by the
-- canonical ServicePlan export, so this is a cross-church read/write leak.
--
-- Neither table carries church_id; they hang off a parent that does, the same
-- shape as service_item in 0005:
--   setlist        → service.church_id      (via setlist.service_id)
--   setlist_song   → setlist → service      (via setlist_song.setlist_id)

-- ── setlist → service.church_id ──────────────────────────────────────────────
alter table public.setlist enable row level security;
create policy setlist_read on public.setlist for select
  using (exists (
    select 1 from public.service s
    where s.id = setlist.service_id and is_member_of(s.church_id)
  ));
create policy setlist_planner_all on public.setlist for all
  using (exists (
    select 1 from public.service s
    where s.id = setlist.service_id and is_planner_of(s.church_id)
  ));

-- ── setlist_song → setlist → service.church_id ───────────────────────────────
alter table public.setlist_song enable row level security;
create policy setlist_song_read on public.setlist_song for select
  using (exists (
    select 1 from public.setlist sl
    join public.service s on s.id = sl.service_id
    where sl.id = setlist_song.setlist_id and is_member_of(s.church_id)
  ));
create policy setlist_song_planner_all on public.setlist_song for all
  using (exists (
    select 1 from public.setlist sl
    join public.service s on s.id = sl.service_id
    where sl.id = setlist_song.setlist_id and is_planner_of(s.church_id)
  ));
