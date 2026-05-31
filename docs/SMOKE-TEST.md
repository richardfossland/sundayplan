# Smoke-test matrix

Things that are wired + compile + pass against fakes/fixtures, but have NOT been
exercised against real infrastructure (no live Postgres/Supabase, external API,
device, or GUI is available in the build environment). Each row needs a manual
pass on real infra before it can be considered verified.

| Area | What's wired | Verified by | UNVERIFIED part | How to smoke-test |
| --- | --- | --- | --- | --- |
| ServicePlan fetch (`packages/sdk/src/serviceplan-assemble.ts` → `fetchServicePlan`) | Query orchestration + canonical assembly behind the `ServicePlanFetcher` port | `serviceplan-assemble.test.ts` (in-memory fake fetcher) | The real `ServicePlanFetcher` implementation that runs Supabase queries (INFRA-UNVERIFIED) | Implement the Supabase-backed `ServicePlanFetcher`, point it at a seeded service, call `fetchServicePlan(fetcher, serviceId)`, confirm the returned `ServicePlan` matches the DB rows and tenancy (`church_id`) is enforced in each query. |
| ServicePlan bundle (`serviceplan-bundle.ts`) | Pure write/read/serialize round-trip | `serviceplan-assemble.test.ts` round-trip | None (pure) — but the on-disk/transport hand-off to SundayStage is unverified end-to-end | Write a bundle to a `.json` file, open it in SundayStage's importer, confirm the service plan renders. |
