/**
 * Approval queue page (planner only). Lists pending bookings with
 * approve/decline/cancel actions; the client component keeps it live.
 */
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { ApprovalQueue } from "@/components/approval-queue";
import { getAuthedContext } from "@/lib/auth-guard";
import { listBookings } from "@/lib/data/booking";
import { getLocale, getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export default async function QueuePage() {
  const ctx = await getAuthedContext();
  if (!ctx) redirect("/sign-in");
  if (!ctx.isPlanner) redirect("/calendar");
  const locale = await getLocale();
  const t = await getT();

  // Pending bookings across a wide window (past month → +6 months).
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
  const to = new Date(now.getFullYear(), now.getMonth() + 6, 1).toISOString();

  const bookings = await listBookings(ctx.churchId, { from, to });
  const pending = bookings.filter((b) => b.status === "pending");

  return (
    <AppShell locale={locale} isPlanner={ctx.isPlanner}>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-ink-50">{t("queue.title")}</h1>
        <p className="mt-1 text-sm text-ink-400">{t("queue.subtitle")}</p>
      </div>
      <ApprovalQueue initial={pending} />
    </AppShell>
  );
}
