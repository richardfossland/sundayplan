"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { schemas } from "@sundayplan/shared";
import { createClient } from "@/lib/supabase/client";

// `useSearchParams` (we read `?error=` / `?next=` from the OAuth callback)
// forces a client-side bailout, so the form lives behind a Suspense boundary.
export default function SignUpPage() {
  return (
    <Suspense fallback={null}>
      <SignUpForm />
    </Suspense>
  );
}

function SignUpForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [oauthBusy, setOauthBusy] = useState<schemas.OAuthProviderName | null>(null);

  // Surface a provider error bounced back from the OAuth callback (`?error=`).
  useEffect(() => {
    const msg = schemas.oauthErrorMessage(searchParams.get("error"));
    if (msg) setError(msg);
  }, [searchParams]);

  async function onOAuth(provider: schemas.OAuthProviderName) {
    setError(null);
    setOauthBusy(provider);
    const next = schemas.sanitizeNextPath(searchParams.get("next"));
    const { error } = await createClient().auth.signInWithOAuth({
      provider,
      options: { redirectTo: schemas.buildOAuthRedirectTo(window.location.origin, next) },
    });
    if (error) {
      setError(error.message);
      setOauthBusy(null);
    }
    // On success Supabase navigates the browser to the provider; nothing to do.
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { data, error } = await createClient().auth.signUp({ email, password });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    // Local dev typically auto-confirms; if a confirmation email is required,
    // there's no session yet.
    if (data.session) {
      router.push("/");
      router.refresh();
    } else {
      setNotice("Check your email to confirm your account, then sign in.");
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-white/[0.07] bg-ink-900/60 p-6">
      <h1 className="text-lg font-semibold text-ink-50">Create your account</h1>
      <p className="mt-1 text-sm text-ink-500">Start planning your church's services.</p>
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
          minLength={6}
          placeholder="Password (min 6 chars)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-lg border border-white/10 bg-ink-950/60 px-3 py-2 text-sm text-ink-100 outline-none placeholder:text-ink-600 focus:border-gold-400/50"
        />
        {error ? <p className="text-xs text-[color:var(--color-danger)]">{error}</p> : null}
        {notice ? <p className="text-xs text-[color:var(--color-success)]">{notice}</p> : null}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-gold-400 px-3 py-2 text-sm font-semibold text-ink-950 transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {loading ? "Creating…" : "Create account"}
        </button>
      </form>
      <div className="my-5 flex items-center gap-3">
        <span className="h-px flex-1 bg-white/10" />
        <span className="text-xs text-ink-600">or continue with</span>
        <span className="h-px flex-1 bg-white/10" />
      </div>
      <div className="space-y-2">
        {schemas.OAUTH_PROVIDERS.map((provider) => (
          <button
            key={provider}
            type="button"
            onClick={() => onOAuth(provider)}
            disabled={oauthBusy !== null}
            className="w-full rounded-lg border border-white/10 bg-ink-950/60 px-3 py-2 text-sm font-medium text-ink-100 transition-colors hover:border-gold-400/40 hover:bg-ink-900/60 disabled:opacity-50"
          >
            {oauthBusy === provider
              ? "Redirecting…"
              : `Continue with ${schemas.OAUTH_PROVIDER_LABELS[provider]}`}
          </button>
        ))}
      </div>
      <p className="mt-4 text-center text-xs text-ink-500">
        Already have an account?{" "}
        <Link href="/sign-in" className="text-gold-300 hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
