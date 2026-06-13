"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui";
import { translate, type Locale } from "@/lib/i18n/messages";
import {
  acceptAgreement,
  completeStubDeposit,
  payDeposit,
} from "@/app/r/[token]/actions";

/**
 * Renter-facing rental agreement + deposit payment (Phase 5). Shows the FROZEN
 * agreement HTML in a sandboxed iframe (no script execution), an e-acceptance
 * button (records accepted_at + the token jti via a server action), and — when
 * a deposit is owed — a "Betal depositum med Vipps" button that hits the seam
 * (stub by default). On returning with `?stub=1` it completes the stub deposit.
 *
 * The token is the only auth; every action re-verifies it server-side.
 */
export function RentalAgreementPanel({
  token,
  agreementHtml,
  initiallyAccepted,
  depositPending,
  paymentPaid,
  locale,
  stubReturn,
}: {
  token: string;
  agreementHtml: string;
  initiallyAccepted: boolean;
  depositPending: boolean;
  paymentPaid: boolean;
  locale: Locale;
  /** True when the renter returned from the stub Vipps redirect (?stub=1). */
  stubReturn: boolean;
}) {
  const t = (k: string) => translate(locale, k);
  const [open, setOpen] = useState(false);
  const [accepted, setAccepted] = useState(initiallyAccepted);
  const [paid, setPaid] = useState(paymentPaid);
  const depositStillPending = depositPending && !paymentPaid;
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  // Complete the stub deposit once on a stub return, then reflect it.
  useEffect(() => {
    if (!stubReturn || paid) return;
    let cancelled = false;
    void completeStubDeposit(token).then((r) => {
      if (!cancelled && r.ok) setPaid(true);
    });
    return () => {
      cancelled = true;
    };
  }, [stubReturn, token, paid]);

  function onAccept() {
    setError(null);
    startTransition(async () => {
      const r = await acceptAgreement(token);
      if (r.ok) setAccepted(true);
      else setError(t("agreement.acceptFailed"));
    });
  }

  function onPay() {
    setError(null);
    if (!accepted) {
      setError(t("agreement.acceptFirst"));
      return;
    }
    startTransition(async () => {
      const r = await payDeposit(token);
      if (r.ok) window.location.href = r.redirectUrl;
      else setError(t("pay.failed"));
    });
  }

  return (
    <div className="space-y-4 rounded-xl border border-white/[0.07] bg-ink-900/50 px-4 py-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-ink-100">{t("agreement.title")}</p>
        <Button variant="ghost" type="button" onClick={() => setOpen((o) => !o)}>
          {open ? t("agreement.hide") : t("agreement.show")}
        </Button>
      </div>

      {open ? (
        <iframe
          title={t("agreement.title")}
          // Sandbox with no allow-scripts: the frozen HTML renders, no JS runs.
          sandbox=""
          srcDoc={agreementHtml}
          className="h-80 w-full rounded-lg border border-white/[0.06] bg-white"
        />
      ) : null}

      {accepted ? (
        <p className="text-center text-sm text-[color:var(--color-success,#4ade80)]">
          {t("agreement.accepted")}
        </p>
      ) : (
        <Button type="button" onClick={onAccept} disabled={busy} className="w-full">
          {busy ? t("agreement.accepting") : t("agreement.accept")}
        </Button>
      )}

      {paid ? (
        <p className="text-center text-sm text-[color:var(--color-success,#4ade80)]">
          {t("pay.depositPaid")}
        </p>
      ) : depositStillPending ? (
        <div className="space-y-2">
          <p className="text-center text-xs text-ink-400">{t("pay.statusPending")}</p>
          <Button
            type="button"
            variant="primary"
            onClick={onPay}
            disabled={busy || !accepted}
            className="w-full"
          >
            {busy ? t("pay.starting") : t("pay.deposit")}
          </Button>
          <p className="text-center text-[11px] text-ink-600">{t("pay.stubNotice")}</p>
        </div>
      ) : null}

      {error ? (
        <p className="text-center text-sm text-[color:var(--color-danger)]">{error}</p>
      ) : null}
    </div>
  );
}
