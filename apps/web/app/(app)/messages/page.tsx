import Link from "next/link";
import { Badge, Card, SectionTitle } from "@/components/ui";
import { listDeliveries, type DeliveryLogItem } from "@/lib/data/comms";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<DeliveryLogItem["status"], "neutral" | "success" | "warning" | "danger" | "info"> = {
  queued: "neutral",
  sent: "info",
  delivered: "success",
  failed: "danger",
  skipped: "warning",
};

const CHANNEL_TONE = { sms: "gold", email: "info", push: "success" } as const;

function when(iso: string): string {
  const d = new Date(iso);
  return d.toISOString().slice(0, 16).replace("T", " ");
}

export default async function MessagesPage() {
  const deliveries = await listDeliveries();
  const sent = deliveries.filter((d) => d.status === "sent" || d.status === "delivered").length;
  const skipped = deliveries.filter((d) => d.status === "skipped").length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <SectionTitle eyebrow="Communications">Messages</SectionTitle>
        <div className="flex items-center gap-3">
          <span className="text-sm text-ink-500">
            {sent} sent · {skipped} skipped · {deliveries.length} total
          </span>
          <Link
            href="/messages/templates"
            className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-ink-200 transition-colors hover:border-white/25"
          >
            Templates
          </Link>
          <Link
            href="/messages/compose"
            className="rounded-lg bg-gold-400 px-3 py-1.5 text-sm font-semibold text-ink-950 transition-opacity hover:opacity-90"
          >
            + Compose
          </Link>
        </div>
      </div>

      {deliveries.length === 0 ? (
        <Card className="px-5 py-10 text-center text-sm text-ink-500">
          No messages sent yet. Compose an invite or reminder for a service&apos;s volunteers.
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/[0.07] bg-ink-900/40">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-white/[0.07] text-left text-xs font-medium uppercase tracking-wider text-ink-500">
                <th className="px-4 py-3">When</th>
                <th className="px-4 py-3">Recipient</th>
                <th className="px-4 py-3">Channel</th>
                <th className="px-4 py-3">Service</th>
                <th className="px-4 py-3">Purpose</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {deliveries.map((d) => (
                <tr key={d.id} className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02]">
                  <td className="px-4 py-3 tabular-nums text-ink-500">{when(d.created_at)}</td>
                  <td className="px-4 py-3">
                    <span className="text-ink-100">{d.member_name ?? "—"}</span>
                    <span className="ml-2 font-mono text-[0.7rem] text-ink-600">{d.to_recipient}</span>
                  </td>
                  <td className="px-4 py-3"><Badge tone={CHANNEL_TONE[d.channel]}>{d.channel}</Badge></td>
                  <td className="px-4 py-3 text-ink-400">{d.service_name ?? "—"}</td>
                  <td className="px-4 py-3 text-ink-400">{d.message_purpose.replace("_", " ")}</td>
                  <td className="px-4 py-3">
                    <Badge tone={STATUS_TONE[d.status]}>{d.status}</Badge>
                    {d.skip_reason ? <span className="ml-2 text-[0.7rem] text-ink-600">{d.skip_reason}</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-center text-xs text-ink-600">
        Deliveries are recorded per recipient. The default provider is a stub (no live transport)
        — real SMS/email/push slot in behind the SDK channel seam.
      </p>
    </div>
  );
}
