"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, STATUS_TONE } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import { useBookingRealtime } from "@/lib/realtime";
import type { Booking } from "@/src/types/booking";

/**
 * Planner approval queue. Lists pending bookings with approve/decline/cancel
 * wired to /api/bookings/[id]/{approve,decline,cancel}. Reflects status changes
 * live via the realtime hook (failures swallowed → manual refresh).
 *
 * If approve returns a 409 conflict (the slot was approved out from under this
 * request), the row shows an inline conflict notice rather than erroring.
 */
export function ApprovalQueue({ initial }: { initial: Booking[] }) {
  const t = useT();
  const [pending, setPending] = useState<Booking[]>(initial);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [conflictId, setConflictId] = useState<string | null>(null);

  async function toggleSignage(id: string, next: boolean) {
    // Optimistic; reconciled by the next refetch.
    setPending((prev) => prev.map((b) => (b.id === id ? { ...b, show_on_signage: next } : b)));
    try {
      await fetch(`/api/bookings/${id}/signage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ showOnSignage: next }),
      });
    } catch {
      /* revert on failure via refetch */
      void refetch();
    }
  }

  const refetch = useCallback(async () => {
    try {
      const now = new Date();
      const from = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
      const to = new Date(now.getFullYear(), now.getMonth() + 6, 1).toISOString();
      const res = await fetch(
        `/api/bookings?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&includeInactive=1`,
        { cache: "no-store" },
      );
      if (!res.ok) return;
      const { bookings } = (await res.json()) as { bookings: Booking[] };
      setPending(bookings.filter((b) => b.status === "pending"));
    } catch {
      /* keep stale */
    }
  }, []);

  useBookingRealtime(refetch);

  // Pick up the initial set on mount too (in case it was rendered stale).
  useEffect(() => {
    void refetch();
  }, [refetch]);

  async function act(id: string, action: "approve" | "decline" | "cancel") {
    setBusyId(id);
    setConflictId(null);
    try {
      const res = await fetch(`/api/bookings/${id}/${action}`, { method: "POST" });
      const data = (await res.json()) as { ok?: boolean; conflict?: boolean };
      if (res.status === 409 || data.conflict) {
        setConflictId(id);
        return;
      }
      if (res.ok && data.ok) {
        // Optimistic: drop it from the pending list; realtime will reconcile.
        setPending((prev) => prev.filter((b) => b.id !== id));
      }
    } catch {
      /* swallow; realtime/refetch will reconcile */
    } finally {
      setBusyId(null);
    }
  }

  if (pending.length === 0) {
    return <p className="text-sm text-ink-500">{t("queue.empty")}</p>;
  }

  return (
    <ul className="space-y-3">
      {pending.map((b) => (
        <li
          key={b.id}
          className="rounded-xl border border-white/[0.07] bg-ink-900/50 p-4"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-medium text-ink-100">{b.title}</span>
                <Badge tone={STATUS_TONE[b.status]}>{t(`status.${b.status}`)}</Badge>
              </div>
              <p className="mt-0.5 text-xs text-ink-500">
                {fmt(b.starts_at_utc)} – {fmt(b.ends_at_utc)}
                {b.setup_min > 0 || b.teardown_min > 0
                  ? ` · +${b.setup_min}/${b.teardown_min} min`
                  : ""}
              </p>
              {b.renter_name ? (
                <p className="mt-0.5 text-xs text-ink-500">
                  {t("queue.requestedBy")}: {b.renter_name}
                </p>
              ) : null}
              <label className="mt-1.5 flex w-fit items-center gap-1.5 text-[0.7rem] text-ink-400">
                <input
                  type="checkbox"
                  checked={b.show_on_signage}
                  onChange={(e) => toggleSignage(b.id, e.target.checked)}
                  className="h-3 w-3 rounded border-white/20 bg-ink-950/60"
                />
                {t("queue.signage")}
              </label>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                onClick={() => act(b.id, "approve")}
                disabled={busyId === b.id}
              >
                {busyId === b.id ? t("queue.working") : t("queue.approve")}
              </Button>
              <Button variant="ghost" onClick={() => act(b.id, "decline")} disabled={busyId === b.id}>
                {t("queue.decline")}
              </Button>
              <Button variant="danger" onClick={() => act(b.id, "cancel")} disabled={busyId === b.id}>
                {t("queue.cancel")}
              </Button>
            </div>
          </div>
          {conflictId === b.id ? (
            <p className="mt-2 text-xs text-[color:var(--color-danger)]">
              {t("queue.conflict")}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function fmt(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
