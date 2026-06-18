/**
 * Root 404. Renders for unmatched routes and explicit `notFound()` calls.
 * Self-contained (no app shell / i18n provider) and styled to match the app's
 * EmptyState pattern, so an out-of-app 404 still feels on-brand.
 */
import Link from "next/link";
import { Compass } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-16">
      <div className="mx-auto max-w-md rounded-xl border border-dashed border-white/[0.1] bg-ink-900/40 px-8 py-12 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-gold-400/10 text-gold-300">
          <Compass className="h-5 w-5" strokeWidth={1.75} aria-hidden />
        </div>
        <div className="mt-4 text-[0.7rem] font-medium uppercase tracking-[0.18em] text-gold-400/80">
          404
        </div>
        <h1 className="mt-1 text-base font-semibold text-ink-50">Page not found</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-ink-400">
          That page doesn&apos;t exist or may have moved. Let&apos;s get you back to your planner.
        </p>
        <Link
          href="/"
          className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-gold-400/90 px-4 py-2 text-sm font-medium text-ink-950 transition-colors hover:bg-gold-400"
        >
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
