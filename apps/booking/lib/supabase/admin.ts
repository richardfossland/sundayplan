import { createClient } from "@supabase/supabase-js";

/**
 * Service-role client — bypasses RLS. SERVER-ONLY: never import this from a
 * client component (the key must never reach the browser). All booking writes
 * go through the SECURITY DEFINER RPCs in the `booking` schema, called via this
 * client from the API routes after the caller's church membership/role has been
 * verified with the user-scoped server client.
 */
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

/**
 * Service-role client scoped to the `booking` schema (PostgREST schema switch),
 * so `.from(...)` and `.rpc(...)` hit `booking.*` instead of `public.*`.
 */
export function createBookingAdminClient() {
  return createAdminClient().schema("booking");
}
