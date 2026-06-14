-- 0025 — booking RPCs are service-role-only; revoke execute from `authenticated`.
--
-- Audit 2026-06-13 (CRITICAL, cross-tenant write): 0022/0024 granted execute on
-- the booking write RPCs (request/approve/decline/cancel_booking,
-- set_payment_status, accept/capture_rental_agreement, seed_default_event_types)
-- to `authenticated`. They are SECURITY DEFINER with NO internal is_planner_of /
-- auth.uid() check, and the `booking` schema is exposed to PostgREST — so any
-- logged-in user of ANY church could POST /rest/v1/rpc/approve_booking with
-- another church's booking id and approve/cancel/pay it. The ownership guard
-- lives only in the Next.js data layer, which is not the only way in.
--
-- Every legitimate caller routes through apps/booking/lib/data/booking.ts, which
-- uses the SERVICE-ROLE admin client (createBookingAdminClient) — never the
-- authenticated browser/SSR client (verified: nothing else does .schema("booking")
-- or calls these RPCs). So `authenticated` never needs execute. service_role keeps
-- it; the app is unaffected; the cross-tenant path is closed. Idempotent.

-- NB: Postgres grants EXECUTE to PUBLIC by default, so revoking from
-- `authenticated`/`anon` alone is NOT enough — PUBLIC still satisfies the
-- privilege check (confirmed via has_function_privilege against postgres:16).
-- Revoke PUBLIC too; service_role keeps its explicit grant from 0022, so the
-- only legitimate caller is unaffected.
revoke execute on all functions in schema booking from public, anon, authenticated;

-- Future functions added to the schema must not silently re-open.
alter default privileges in schema booking revoke execute on functions from public, anon, authenticated;
