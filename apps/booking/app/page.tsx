/**
 * SundayBooking home (Phase 0). Proves end-to-end wiring: a signed-in planner
 * sees their church's resources + upcoming bookings, read through the
 * service-role data layer scoped to their verified church membership. Rich
 * calendar/admin UI is the next phase.
 */
import { getAuthedContext } from "@/lib/auth-guard";
import { listBookings, listResources } from "@/lib/data/booking";
import { getT } from "@/lib/i18n/server";
import type { BookingStatus } from "@/src/types/booking";

export const dynamic = "force-dynamic";

const STATUS_KEY: Record<BookingStatus, string> = {
  pending: "status.pending",
  approved: "status.approved",
  declined: "status.declined",
  cancelled: "status.cancelled",
};

function fmt(iso: string): string {
  // Stable server-side format (no locale data dependency in Phase 0).
  return new Date(iso).toISOString().slice(0, 16).replace("T", " ");
}

export default async function HomePage() {
  const t = await getT();
  const ctx = await getAuthedContext();

  // Middleware guarantees a session; this guards the membership/role.
  if (!ctx) {
    return (
      <Shell title={t("home.title")} subtitle={t("home.subtitle")}>
        <p className="text-sm text-ink-400">{t("home.needPlanner")}</p>
      </Shell>
    );
  }

  const [resources, bookings] = await Promise.all([
    listResources(ctx.churchId),
    listBookings(ctx.churchId),
  ]);

  return (
    <Shell title={t("home.title")} subtitle={t("home.subtitle")}>
      <div className="grid gap-8 md:grid-cols-2">
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-400">
            {t("home.resources")}
          </h2>
          {resources.length === 0 ? (
            <p className="text-sm text-ink-500">{t("home.empty.resources")}</p>
          ) : (
            <ul className="space-y-2">
              {resources.map((r) => (
                <li
                  key={r.id}
                  className="rounded-lg border border-white/[0.07] bg-ink-900/50 px-4 py-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-ink-100">{r.name}</span>
                    <span className="text-xs uppercase tracking-wide text-ink-500">
                      {r.kind}
                    </span>
                  </div>
                  {r.site ? (
                    <p className="mt-0.5 text-xs text-ink-500">{r.site}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-400">
            {t("home.upcoming")}
          </h2>
          {bookings.length === 0 ? (
            <p className="text-sm text-ink-500">{t("home.empty.bookings")}</p>
          ) : (
            <ul className="space-y-2">
              {bookings.map((b) => (
                <li
                  key={b.id}
                  className="rounded-lg border border-white/[0.07] bg-ink-900/50 px-4 py-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-ink-100">{b.title}</span>
                    <span className="text-xs text-ink-500">
                      {t(STATUS_KEY[b.status])}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-ink-500">
                    {fmt(b.starts_at_utc)} – {fmt(b.ends_at_utc)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Shell>
  );
}

function Shell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <header className="mb-8 flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-gradient-to-br from-royal-500 to-royal-700 text-base font-bold text-gold-300">
          S
        </div>
        <span className="text-lg font-semibold tracking-tight text-ink-100">
          Sunday<span className="text-gold-400">Booking</span>
        </span>
      </header>
      <h1 className="text-2xl font-semibold text-ink-50">{title}</h1>
      <p className="mt-1 text-sm text-ink-400">{subtitle}</p>
      <div className="mt-8">{children}</div>
    </main>
  );
}
