"use client";

import { useState, useTransition } from "react";
import { Badge, Button } from "@/components/ui";
import { translate, type Locale } from "@/lib/i18n/messages";
import { cancelRenterBooking } from "@/app/r/[token]/actions";
import type { BookingStatus } from "@/src/types/booking";

const STATUS_TONE: Record<BookingStatus, "warning" | "success" | "danger" | "neutral"> = {
  pending: "warning",
  approved: "success",
  declined: "danger",
  cancelled: "neutral",
};

/** Renter-facing status + cancel control. The token is the only auth. */
export function RenterStatus({
  token,
  initialStatus,
  cancellable,
  locale,
}: {
  token: string;
  initialStatus: BookingStatus;
  cancellable: boolean;
  locale: Locale;
}) {
  const t = (k: string, v?: Record<string, string | number>) => translate(locale, k, v);
  const [status, setStatus] = useState<BookingStatus>(initialStatus);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const canCancel = cancellable && status === "pending";

  function onCancel() {
    setError(null);
    startTransition(async () => {
      const res = await cancelRenterBooking(token);
      if (res.ok) setStatus(res.status);
      else setError(t("renter.cancelFailed"));
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-center">
        <Badge tone={STATUS_TONE[status]}>{t(`status.${status}`)}</Badge>
      </div>
      <p className="text-center text-sm text-ink-400">{t(`renter.status.${status}`)}</p>

      {canCancel ? (
        <Button variant="danger" type="button" onClick={onCancel} disabled={pending} className="w-full">
          {pending ? t("renter.cancelling") : t("renter.cancel")}
        </Button>
      ) : null}

      {error ? <p className="text-center text-sm text-[color:var(--color-danger)]">{error}</p> : null}
    </div>
  );
}
