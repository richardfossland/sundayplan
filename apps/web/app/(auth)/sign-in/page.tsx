"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { schemas } from "@sundayplan/shared";
import { createClient } from "@/lib/supabase/client";

// `useSearchParams` (we read `?next=` so an invite link bounces the planner back
// to `/r/<token>/join` after they sign in) forces a client-side bailout, so the
// form lives behind a Suspense boundary — same shape as the sign-up page.
export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignInForm />
    </Suspense>
  );
}

function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Where to land after auth: a sanitised same-origin path (the invite path, the
  // OAuth `next`, …) or `/` so the `(app)` layout decides onboarding vs dashboard.
  const next = schemas.sanitizeNextPath(searchParams.get("next"));
  const signUpHref = next === "/" ? "/sign-up" : `/sign-up?next=${encodeURIComponent(next)}`;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await createClient().auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    router.push(next);
    router.refresh();
  }

  return (
    <div className="rounded-xl border border-white/[0.07] bg-ink-900/60 p-6">
      <h1 className="text-lg font-semibold text-ink-50">Welcome back</h1>
      <p className="mt-1 text-sm text-ink-500">Sign in to your planner account.</p>
      <form onSubmit={onSubmit} className="mt-5 space-y-3">
        <input
          type="email"
          required
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-lg border border-white/10 bg-ink-950/60 px-3 py-2 text-sm text-ink-100 outline-none placeholder:text-ink-600 focus:border-gold-400/50"
        />
        <input
          type="password"
          required
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-lg border border-white/10 bg-ink-950/60 px-3 py-2 text-sm text-ink-100 outline-none placeholder:text-ink-600 focus:border-gold-400/50"
        />
        {error ? <p className="text-xs text-[color:var(--color-danger)]">{error}</p> : null}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-gold-400 px-3 py-2 text-sm font-semibold text-ink-950 transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <p className="mt-4 text-center text-xs text-ink-500">
        No account?{" "}
        <Link href={signUpHref} className="text-gold-300 hover:underline">
          Create one
        </Link>
      </p>
    </div>
  );
}
