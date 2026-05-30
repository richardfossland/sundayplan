-- SundayPlan migration 0010 — platform identity (Sunday ID)
--
-- Fase 0 of the Sunday-platform work. SundayPlan's Supabase project becomes the
-- authoritative identity provider for the whole suite ("one Sunday account"):
-- `church` is the tenant, `church_member` is the membership, and this migration
-- adds the two missing pieces:
--
--   1. app_grant — per-(user, church, app) access. "One account" must not mean
--      "every app for everyone": a volunteer may have Stage but not Plan-admin.
--      `church_member.role` stays the coarse role; app_grant is the fine grain.
--   2. custom_access_token_hook — stamps every Supabase JWT with a `church_ids`
--      claim (the churches the user belongs to) and an `app_grants` claim. The
--      SundaySong API validates these JWTs via JWKS and derives church scope
--      from the token — never trusting a church_id sent in the request body.
--
-- Additive only; no existing table or policy changes. Not yet applied/verified
-- here (needs Supabase + the auth hook enabled in project config — see
-- docs/DEPLOYMENT.md).

-- ── app_grant ─────────────────────────────────────────────────────────────────
-- Short, stable app keys (match the Sunday suite): plan, stage, rec, song, edit,
-- studio, paper. (church_settings.*_connected stays the church-wide "is this app
-- wired up" flag; app_grant is the per-user grant.)
create table if not exists public.app_grant (
  church_id   uuid not null references public.church(id)     on delete cascade,
  user_id     uuid not null references auth.users(id)        on delete cascade,
  app         text not null check (app in ('plan','stage','rec','song','edit','studio','paper')),
  enabled     boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (church_id, user_id, app)
);
create index if not exists app_grant_user_idx on public.app_grant (user_id);

alter table public.app_grant enable row level security;

create trigger set_updated_at_app_grant
  before update on public.app_grant
  for each row execute function public.set_updated_at();

-- Helper: does the current user have an enabled grant for an app in a church?
create or replace function public.has_app_grant(check_church_id uuid, check_app text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.app_grant
    where church_id = check_church_id
      and user_id   = auth.uid()
      and app       = check_app
      and enabled
  );
$$;

-- RLS: a user reads their own grants (and planners see the whole church's);
-- only planners/admins manage grants.
create policy app_grant_read_self
  on public.app_grant for select
  using (user_id = auth.uid() or is_planner_of(church_id));

create policy app_grant_planner_manage
  on public.app_grant for all
  using (is_planner_of(church_id))
  with check (is_planner_of(church_id));

-- ── custom_access_token_hook ─────────────────────────────────────────────────
-- Supabase Auth calls this on every token issue/refresh once configured under
-- Auth > Hooks (Customize Access Token). It adds:
--   church_ids : uuid[] of the churches the user belongs to
--   app_grants : { "<church_id>": ["stage","rec",...] } enabled grants
-- so downstream services (SundaySong) authorize from the token alone.
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  claims        jsonb;
  uid           uuid := (event->>'user_id')::uuid;
  church_ids    jsonb;
  grants        jsonb;
begin
  select coalesce(jsonb_agg(distinct church_id), '[]'::jsonb)
    into church_ids
    from public.church_member
    where user_id = uid;

  select coalesce(
           jsonb_object_agg(church_id, apps),
           '{}'::jsonb
         )
    into grants
    from (
      select church_id::text as church_id, jsonb_agg(app order by app) as apps
        from public.app_grant
        where user_id = uid and enabled
        group by church_id
    ) g;

  claims := coalesce(event->'claims', '{}'::jsonb);
  claims := jsonb_set(claims, '{church_ids}', church_ids);
  claims := jsonb_set(claims, '{app_grants}', grants);
  event  := jsonb_set(event, '{claims}', claims);
  return event;
end;
$$;

-- The auth admin role runs the hook; lock it down to that role only.
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;

-- The hook (running as supabase_auth_admin) must read these tables.
grant select on public.church_member to supabase_auth_admin;
grant select on public.app_grant     to supabase_auth_admin;
