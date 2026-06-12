-- Recreate the Supabase-provided objects the migrations depend on, so the REAL
-- migration files apply unmodified against a vanilla postgres:16 container
-- (scripts/test-db.sh). Mirrors the pattern proven in the standalone apps.

create extension if not exists pgcrypto;

create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create role supabase_auth_admin nologin;
alter role service_role bypassrls;

create publication supabase_realtime;

-- Minimal auth schema: the `users` table the FKs point at, plus the `uid()` /
-- `jwt()` helpers RLS policies call. The helpers read local GUCs so tests can
-- impersonate any user/claims with set_config().
create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text
);

create or replace function auth.uid()
returns uuid
language sql stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create or replace function auth.jwt()
returns jsonb
language sql stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
$$;

-- Real Supabase grants the API roles broad object privileges (RLS is the
-- gate). Mirror that for objects the migrations are ABOUT to create.
grant usage on schema public, auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public
  grant execute on functions to anon, authenticated, service_role;
