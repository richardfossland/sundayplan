/**
 * Utilization dashboard page (planner only). Occupancy per resource/period,
 * busiest hours, free %, and upcoming external rentals. Data is read via the
 * service-role layer (church_id from the verified membership) and aggregated by
 * the pure utilization core on the client.
 */
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import {
  Dashboard,
  type DashboardBlock,
  type DashboardResource,
  type UpcomingRental,
} from "@/components/dashboard";
import { getAuthedContext } from "@/lib/auth-guard";
import {
  listResources,
  listUtilizationBlocks,
  listBookings,
} from "@/lib/data/booking";
import { getLocale, getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const ctx = await getAuthedContext();
  if (!ctx) redirect("/sign-in");
  if (!ctx.isPlanner) redirect("/calendar");
  const locale = await getLocale();
  const t = await getT();

  const now = new Date();
  // Aggregate over a wide window (now → +90d); the client trims per period.
  const from = now.toISOString();
  const to = new Date(now.getTime() + 90 * 86_400_000).toISOString();

  const [resources, blocks, upcoming] = await Promise.all([
    listResources(ctx.churchId),
    listUtilizationBlocks(ctx.churchId, { from, to }),
    listBookings(ctx.churchId, { from, to }),
  ]);

  const dashBlocks: DashboardBlock[] = blocks.map((b) => ({
    resourceId: b.resource_id,
    startMs: b.start_ms,
    endMs: b.end_ms,
    isExternal: b.is_external,
  }));
  const dashResources: DashboardResource[] = resources.map((r) => ({ id: r.id, name: r.name }));

  // Upcoming external rentals = approved bookings with a renter name + no auth user.
  const rentals: UpcomingRental[] = upcoming
    .filter((b) => b.status === "approved" && b.renter_name && !b.requested_by)
    .slice(0, 12)
    .map((b) => ({
      id: b.id,
      title: b.title,
      starts_at_utc: b.starts_at_utc,
      renter_name: b.renter_name,
    }));

  return (
    <AppShell locale={locale} isPlanner={ctx.isPlanner}>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-ink-50">{t("dash.title")}</h1>
        <p className="mt-1 text-sm text-ink-400">{t("dash.subtitle")}</p>
      </div>
      <Dashboard
        blocks={dashBlocks}
        resources={dashResources}
        rentals={rentals}
        nowMs={now.getTime()}
        openHoursPerDay={16}
      />
    </AppShell>
  );
}
