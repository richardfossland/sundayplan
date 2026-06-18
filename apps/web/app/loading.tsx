/**
 * Root loading skeleton. Many pages are `force-dynamic` async server components
 * that fetch from Supabase before rendering — without this they flash a blank
 * screen on navigation. The skeleton mirrors the dashboard's shape (title +
 * stat-tile row + two-up cards) so the layout doesn't jump when content lands.
 */
function Shimmer({ className = "" }: { className?: string }) {
  return (
    <div
      className={
        "animate-pulse rounded-md bg-white/[0.06] " + className
      }
    />
  );
}

function TileSkeleton() {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-ink-900/60 px-5 py-4 backdrop-blur-sm">
      <Shimmer className="h-3 w-20" />
      <Shimmer className="mt-3 h-7 w-14" />
      <Shimmer className="mt-2 h-2.5 w-24" />
    </div>
  );
}

function CardSkeleton() {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-ink-900/60 backdrop-blur-sm">
      <div className="flex items-center justify-between gap-4 border-b border-white/[0.06] px-5 py-4">
        <Shimmer className="h-4 w-32" />
        <Shimmer className="h-5 w-16 rounded-full" />
      </div>
      <div className="space-y-3 px-5 py-4">
        <Shimmer className="h-3.5 w-3/4" />
        <Shimmer className="h-3 w-1/2" />
        <Shimmer className="h-9 w-40 rounded-lg" />
      </div>
    </div>
  );
}

export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl space-y-8 px-6 py-8" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="space-y-2">
        <Shimmer className="h-2.5 w-24" />
        <Shimmer className="h-8 w-64" />
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <TileSkeleton />
        <TileSkeleton />
        <TileSkeleton />
        <TileSkeleton />
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    </div>
  );
}
