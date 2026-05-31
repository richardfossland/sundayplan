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
