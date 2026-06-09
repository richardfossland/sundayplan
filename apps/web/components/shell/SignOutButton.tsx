"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * `scope` controls how widely the sign-out reaches (Supabase `signOut` scope):
 *   - "global" (default): revoke EVERY session for this account, on every
 *     device — including the desktop Sunday apps, whose next token refresh then
 *     fails and forces a re-login. This is the "sign out of all devices" /
 *     lost-device defense.
 *   - "local": sign out only this browser, leaving other devices logged in.
 */
export function SignOutButton({ scope = "global" }: { scope?: "global" | "local" }) {
  const router = useRouter();
  async function signOut() {
    await createClient().auth.signOut({ scope });
    router.push("/sign-in");
    router.refresh();
  }
  return (
    <button
      onClick={signOut}
      className="rounded-md px-2 py-1 text-xs text-ink-500 transition-colors hover:bg-white/[0.04] hover:text-ink-200"
    >
      Sign out
    </button>
  );
}
