/**
 * Member request page — "Be om booking" (Phase 3). A logged-in member (SSO)
 * requests a member-/public-bookable resource. Distinct from the planner
 * calendar: it's a focused request form + the member's own request history with
 * live status. The booking becomes pending, or auto-approved when the resource/
 * event-type requires_approval=false (the RPC decides; the UI flags which).
 */
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { MemberRequest } from "@/components/member-request";
import { getAuthedContext } from "@/lib/auth-guard";
import {
  listEventTypes,
  listMemberBookableResources,
  listMyRequests,
} from "@/lib/data/booking";
import { getLocale } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export default async function RequestPage() {
  const ctx = await getAuthedContext();
  if (!ctx) redirect("/sign-in");
  const locale = await getLocale();

  const [resources, eventTypes, myRequests] = await Promise.all([
    listMemberBookableResources(ctx.churchId),
    listEventTypes(ctx.churchId),
    listMyRequests(ctx.churchId, ctx.userId),
  ]);

  const safeEventTypes = eventTypes.map((e) => ({
    id: e.id,
    name: e.name,
    default_duration_min: e.default_duration_min,
    requires_approval: e.requires_approval,
  }));

  return (
    <AppShell locale={locale} isPlanner={ctx.isPlanner}>
      <MemberRequest
        resources={resources}
        eventTypes={safeEventTypes}
        myRequests={myRequests}
      />
    </AppShell>
  );
}
