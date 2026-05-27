-- SundayPlan migration 0001 — tenancy
-- Sets up the church root + church_member link table. RLS enabled but no
-- policies yet — policies are added per-table in 0002.

create extension if not exists "pgcrypto";

-- ── Church (tenant root) ────────────────────────────────────────────────────
create table public.church (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  slug          text not null unique check (slug ~ '^[a-z0-9-]+$'),
  plan_tier     text not null default 'free' check (plan_tier in ('free','starter','growth','network')),
  locale        text not null default 'no',
  timezone      text not null default 'Europe/Oslo',
  denomination  text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index church_slug_idx on public.church (slug);

alter table public.church enable row level security;

-- ── User profile (extension of auth.users) ──────────────────────────────────
create table public.user_profile (
  id                  uuid primary key references auth.users(id) on delete cascade,
  display_name        text,
  avatar_url          text,
  locale_preference   text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

alter table public.user_profile enable row level security;

create policy user_profile_self_read
  on public.user_profile for select
  using (auth.uid() = id);

create policy user_profile_self_write
  on public.user_profile for update
  using (auth.uid() = id);

-- ── ChurchMember (user ↔ church) ────────────────────────────────────────────
create table public.church_member (
  church_id   uuid not null references public.church(id) on delete cascade,
  user_id     uuid not null references auth.users(id)    on delete cascade,
  role        text not null check (role in ('admin','planner','team_lead','viewer')),
  created_at  timestamptz not null default now(),
  primary key (church_id, user_id)
);
create index church_member_user_idx on public.church_member (user_id);

alter table public.church_member enable row level security;

-- Helper: current user belongs to a church
create or replace function public.is_member_of(check_church_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.church_member
    where church_id = check_church_id
      and user_id   = auth.uid()
  );
$$;

-- Helper: current user has at least planner-level access to a church
create or replace function public.is_planner_of(check_church_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.church_member
    where church_id = check_church_id
      and user_id   = auth.uid()
      and role in ('admin','planner')
  );
$$;

-- Now we can write Church-level policies
create policy church_member_read
  on public.church for select
  using (is_member_of(id));

create policy church_planner_update
  on public.church for update
  using (is_planner_of(id));

create policy church_member_read_self
  on public.church_member for select
  using (user_id = auth.uid() or is_planner_of(church_id));

-- ── updated_at trigger ──────────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_updated_at_church
  before update on public.church
  for each row execute function public.set_updated_at();

create trigger set_updated_at_user_profile
  before update on public.user_profile
  for each row execute function public.set_updated_at();
