import { createBrowserClient } from "@supabase/ssr";

import { sharedCookieOptions } from "./cookies";

/** Browser Supabase client — stores the session in cookies the server reads.
 * The shared cookie domain (when configured) makes the session span every
 * `*.sundaysuite.app` subdomain (web↔web SSO). */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookieOptions: sharedCookieOptions() },
  );
}
