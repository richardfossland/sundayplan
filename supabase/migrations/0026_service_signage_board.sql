-- SundayPlan migration 0026 — service signage feed for SundayInfo.
--
-- Adds public.service_signage_board(p_church_id, p_now): the current-or-next
-- PUBLISHED service for a church together with its order-of-service items.
-- Consumed by the separate SundayInfo app (same Supabase project; it reads the
-- `public` tenancy schema via its service-role client) to render a
-- "dagens gudstjeneste" slide on foyer screens. Mirrors the booking.signage_board
-- pattern (migration 0023) but for the worship service plan. Idempotent.
--
-- SECURITY: `public` is exposed to PostgREST and Postgres grants EXECUTE to
-- PUBLIC by default, so a SECURITY DEFINER function here would let ANY anon /
-- authenticated caller read ANY church's service plan by passing an arbitrary
-- church id — a cross-tenant leak, exactly what migration 0025 closed for the
-- booking RPCs. We therefore REVOKE execute from PUBLIC and grant it only to
-- service_role, the single legitimate caller (SundayInfo's display feed).
--
-- DEPLOY NOTE: `public` is already exposed for PostgREST. No table/grant changes
-- are needed — only the function below. Safe to re-run.

create or replace function public.service_signage_board(
  p_church_id uuid,
  p_now timestamptz default now()
) returns jsonb
language sql stable
security definer
set search_path = public
as $$
  -- The single most relevant service: the earliest published / in-progress
  -- service that either is happening now (started up to 3h ago, ≈ service +
  -- mingling) or is upcoming within the next 7 days. Drafts/archived never show.
  with svc as (
    select s.id, s.name, s.starts_at_utc
      from public.service s
     where s.church_id = p_church_id
       and s.state in ('published','in_progress')
       and s.starts_at_utc >= p_now - interval '3 hours'
       and s.starts_at_utc <  p_now + interval '7 days'
     order by s.starts_at_utc
     limit 1
  )
  select jsonb_build_object(
           'service_id', svc.id,
           'name',       svc.name,
           'starts',     svc.starts_at_utc,
           'items', coalesce((
             select jsonb_agg(
                      jsonb_build_object(
                        'position',     si.position,
                        'label',        si.label,
                        'kind',         si.kind,
                        'duration_min', si.duration_min)
                      order by si.position)
               from public.service_item si
              where si.service_id = svc.id
           ), '[]'::jsonb)
         )
    from svc;
$$;

-- service-role-only (see SECURITY note above). revoke from PUBLIC first, since
-- Postgres grants EXECUTE to PUBLIC by default and that covers anon/authenticated.
revoke execute on function public.service_signage_board(uuid, timestamptz) from public;
grant  execute on function public.service_signage_board(uuid, timestamptz) to service_role;
