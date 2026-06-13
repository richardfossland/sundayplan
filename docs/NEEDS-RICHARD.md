# Needs-Richard

Work that requires real infrastructure, credentials, a GUI, or a device — which
the build/test environment cannot provide. Documented here rather than attempted.

## ServicePlan export bridge (Phase 7)

- **Implement the Supabase-backed `ServicePlanFetcher`.** The port + the pure
  assembly/orchestration are done and tested (`packages/sdk/src/serviceplan-assemble.ts`,
  `serviceplan-bundle.ts`). What's missing is the concrete fetcher that runs the
  `service` / `service_item` / `setlist` / `setlist_song` / `song` queries against
  Supabase (and enforces `church_id` tenancy + RLS). Needs a live DB + auth.
- **End-to-end hand-off to SundayStage.** Once a real bundle can be produced, hand
  the `ServicePlanBundle` JSON to SundayStage's importer and confirm it renders the
  setlist + items. Needs both apps running. See `docs/SMOKE-TEST.md`.
- **Next.js API route.** A `GET /api/services/:id/serviceplan` route can wrap
  `fetchServicePlan` once the Supabase client + a real fetcher exist; deferred until
  the SDK client is wired (Phase 1.3) so the route has a fetcher to inject.

## Comms transport (Phase 6)

- The provider seam (`channels.ts`) is injectable and stub-defaulted. Wiring a real
  Twilio (SMS) / Resend or SMTP (email) / Web Push adapter needs vendor accounts +
  secrets and live network — not attempted here.

## SundayBooking Phase 4 (NL booking / signage / ICS / dashboard)

- **`ANTHROPIC_API_KEY`** — natural-language booking (`POST /api/bookings/parse`)
  only calls Claude when this is set; otherwise the route returns
  `{available:false}` and the prompt bar hides ("AI ikke tilgjengelig"). The
  manual form, fuzzy matcher, Norwegian date interpreter and proposal normalizer
  all work without a key (unit-tested with canned fixtures). Model: `claude-opus-4-8`
  (override `SUNDAYPLAN_BOOKING_MODEL`).
- **Cloud-AI opt-in** — `church_settings.ai_consent` must be true for a church
  to use NL parsing (GDPR posture). Per-church monthly AI quota lives on
  `church_settings.ai_quota_used` (migration 0023); limits in `lib/ai-quota.ts`.
- **`MAGICLINK_SECRET`** — required to mint/verify the per-resource ICS feed token
  for NON-public resources. Public resources' ICS feeds are open. Without it,
  member/staff ICS feeds return 403.
- **Migration 0023** — `0023_booking_signage_ics.sql` must be applied in the
  Supabase SQL editor (the `booking` schema is already exposed per 0022's note).
  Idempotent; verified applied-twice-clean by `scripts/test-db.sh`.
- **SundayInfo wiring** — see `apps/booking/docs/SIGNAGE-FEED.md` for how Info
  consumes `GET /api/signage/:churchSlug`. No sundayinfo changes were made here.
- **Rig test** — NL parse against a live key + real church resources; ICS
  subscription in Google/Apple/Outlook; foyer-screen render via SundayInfo.
