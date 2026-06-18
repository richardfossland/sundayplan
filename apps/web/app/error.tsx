"use client";

/**
 * Root error boundary. Renders when a server/client render throws anywhere in
 * the tree. Must be a client component and accept `error` + `reset` (Next.js
 * App Router contract). Kept self-contained — it can fire before the app shell
 * or i18n provider mount, so it relies only on the global theme tokens.
 */
import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface the failure for local debugging / production log scraping.
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-16">
      <div className="mx-auto max-w-md rounded-xl border border-dashed border-[color:var(--color-danger)]/30 bg-ink-900/40 px-8 py-12 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[color:var(--color-danger)]/10 text-[color:var(--color-danger)]">
          <AlertTriangle className="h-5 w-5" strokeWidth={1.75} aria-hidden />
        </div>
        <h1 className="mt-4 text-base font-semibold text-ink-50">Something went wrong</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-ink-400">
          An unexpected error interrupted this page. You can try again — if it keeps happening,
          the issue is on our side and we&apos;re looking into it.
        </p>
        {error?.digest ? (
          <p className="mt-3 font-mono text-[0.7rem] text-ink-600">ref: {error.digest}</p>
        ) : null}
        <button
          type="button"
          onClick={reset}
          className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-gold-400/90 px-4 py-2 text-sm font-medium text-ink-950 transition-colors hover:bg-gold-400"
        >
          <RotateCcw className="h-4 w-4" strokeWidth={2} aria-hidden />
          Try again
        </button>
      </div>
    </div>
  );
}
