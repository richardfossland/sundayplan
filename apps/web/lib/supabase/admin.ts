import { createClient } from "@supabase/supabase-js";

/**
 * Service-role client — bypasses RLS. SERVER-ONLY: never import this from a
 * client component (the key must never reach the browser). Used for operations
 * with no RLS insert path, e.g. creating the first church during onboarding.
 */
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
