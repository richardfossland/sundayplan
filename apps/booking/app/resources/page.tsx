/**
 * Resource admin page (planner only). Manages resources, event types and
 * bundles. Non-planners are redirected to the calendar.
 */
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { ResourceAdmin } from "@/components/resource-admin";
import { getAuthedContext } from "@/lib/auth-guard";
import { listBundles, listEventTypes, listResources } from "@/lib/data/booking";
import { getLocale, getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export default async function ResourcesPage() {
  const ctx = await getAuthedContext();
  if (!ctx) redirect("/sign-in");
  if (!ctx.isPlanner) redirect("/calendar");
  const locale = await getLocale();
  const t = await getT();

  const [resources, eventTypes, bundles] = await Promise.all([
    listResources(ctx.churchId),
    listEventTypes(ctx.churchId),
    listBundles(ctx.churchId),
  ]);

  return (
    <AppShell locale={locale} isPlanner={ctx.isPlanner}>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-ink-50">{t("res.title")}</h1>
        <p className="mt-1 text-sm text-ink-400">{t("res.subtitle")}</p>
      </div>
      <ResourceAdmin
        initialResources={resources}
        initialEventTypes={eventTypes}
        initialBundles={bundles.map((b) => ({
          id: b.id,
          church_id: b.church_id,
          name: b.name,
          primary_resource_id: b.primary_resource_id,
          item_resource_ids: b.item_resource_ids,
        }))}
      />
    </AppShell>
  );
}
