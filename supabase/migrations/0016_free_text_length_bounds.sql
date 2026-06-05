-- SundayPlan migration 0016 — defence-in-depth length bounds on free-text columns
-- The Zod schemas (packages/shared) bound these fields, but the DB is the last
-- line of defence: a future code path, a direct service-role write, or a missed
-- validation must not be able to stash an unbounded blob in a short identifier /
-- label column. These mirror the schema `.max()` limits exactly.
--
-- DEFAULT-safe: every constraint allows NULL and only caps length. Existing rows
-- hold short denominations / licence numbers / customer ids well under these
-- caps, so adding the constraints is behaviour-preserving. No data is rewritten,
-- no defaults change, no RLS touched.
--
-- ⚠️ NEEDS LIVE APPLY: run `supabase db push` against each environment. Offline
-- this file is only checked into the migration set; the surrounding Zod guard is
-- offline-tested in packages/shared.

alter table public.church
  add constraint church_denomination_len_chk
    check (denomination is null or char_length(denomination) <= 120);

alter table public.church_settings
  add constraint church_settings_ccli_license_number_len_chk
    check (ccli_license_number is null or char_length(ccli_license_number) <= 64);

alter table public.church_settings
  add constraint church_settings_tono_customer_id_len_chk
    check (tono_customer_id is null or char_length(tono_customer_id) <= 64);
