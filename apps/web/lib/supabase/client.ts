import { createBrowserClient } from "@supabase/ssr";

/** Browser Supabase client — stores the session in cookies the server reads. */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
