import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { sharedCookieOptions } from "./cookies";

/** Server Supabase client bound to the request cookies (RLS runs as the user).
 * Use this to read the caller's session + verify church membership. The booking
 * `booking` schema is RLS-readable by members, so reads can also run here. */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: sharedCookieOptions(),
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          // In Server Components cookie writes throw; the middleware refreshes
          // the session, so swallowing here is safe.
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // no-op in RSC render context
          }
        },
      },
    },
  );
}
