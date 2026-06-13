/**
 * Calendar page (server). Resolves the viewer's church, pre-loads the current
 * week's bookings + their resources + overlapping services, then hands off to
 * the client <Calendar/> which manages views, filtering, realtime + the
 * create-booking form.
 */
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Calendar, type BundleLite } from "@/components/calendar";
import { getAuthedContext } from "@/lib/auth-guard";
import {
  listBookingResources,
  listBookings,
  listBundles,
  listEventTypes,
  listResources,
  listServices,
} from "@/lib/data/booking";
import { getLocale } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export default async function CalendarPage() {
  const ctx = await getAuthedContext();
  if (!ctx) redirect("/sign-in");
  const locale = await getLocale();

  // Wide initial window so the first paint covers any week the user lands on.
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const to = new Date(now.getFullYear(), now.getMonth() + 2, 1).toISOString();

  const [resources, eventTypes, bundlesFull, bookings, services] = await Promise.all([
    listResources(ctx.churchId),
    listEventTypes(ctx.churchId),
    listBundles(ctx.churchId),
    listBookings(ctx.churchId, { from, to }),
    listServices(ctx.churchId, { from, to }),
  ]);
  const bookingResources = await listBookingResources(bookings.map((b) => b.id));

  const bundles: BundleLite[] = bundlesFull.map((b) => ({
    id: b.id,
    name: b.name,
    primary_resource_id: b.primary_resource_id,
  }));

  return (
    <AppShell locale={locale} isPlanner={ctx.isPlanner}>
      <Calendar
        initial={{ bookings, bookingResources, services }}
        resources={resources}
        eventTypes={eventTypes}
        bundles={bundles}
        userId={ctx.userId}
        isPlanner={ctx.isPlanner}
      />
    </AppShell>
  );
}
