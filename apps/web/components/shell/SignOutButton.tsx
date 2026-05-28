"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function SignOutButton() {
  const router = useRouter();
  async function signOut() {
    await createClient().auth.signOut();
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
