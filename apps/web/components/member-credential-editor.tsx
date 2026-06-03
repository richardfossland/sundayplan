"use client";

import { useActionState, useTransition } from "react";
import {
  saveMemberCredential,
  deleteMemberCredential,
  type CredentialState,
} from "@/app/(app)/people/actions";
import type { CredentialRow } from "@/lib/data/people";
import {
  CREDENTIAL_KINDS,
  CREDENTIAL_STATUSES,
  isCredentialCurrent,
  type CredentialKind,
} from "@sundayplan/sdk";
import { Badge, Card, CardHeader } from "@/components/ui";
import { shortDate } from "@/components/people-ui";
import { useT } from "@/lib/i18n/client";

const initial: CredentialState = { error: null };

const input =
  "rounded-lg border border-white/10 bg-ink-950/60 px-3 py-2 text-sm text-ink-100 outline-none placeholder:text-ink-600 focus:border-gold-400/50";
const label = "mb-1 block text-xs font-medium text-ink-400";
const ghostBtn =
  "rounded-lg border border-white/10 px-3 py-1.5 text-sm font-medium text-ink-200 transition-colors hover:border-gold-400/40 hover:text-gold-300 disabled:opacity-50";

/** Badge tone for a credential's effective state (expiry counts as not-current). */
function statusTone(row: CredentialRow): "success" | "warning" | "danger" | "neutral" {
  if (isCredentialCurrent({ kind: row.kind, status: row.status, expires_at: row.expires_at }))
    return "success";
  if (row.status === "pending") return "warning";
  if (row.status === "expired") return "danger";
  return "neutral";
}

function AddForm({
  memberId,
  existingKinds,
}: {
  memberId: string;
  existingKinds: Set<CredentialKind>;
}) {
  const t = useT();
  // Default to the first kind the member doesn't already hold (re-saving an
  // existing kind edits it in place via the upsert).
  const firstFree = CREDENTIAL_KINDS.find((k) => !existingKinds.has(k)) ?? CREDENTIAL_KINDS[0];
  const [state, action, pending] = useActionState(
    saveMemberCredential.bind(null, memberId),
    initial,
  );

  return (
    <form action={action} className="space-y-3 px-5 py-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label}>{t("credentials.kind")}</label>
          <select name="kind" defaultValue={firstFree} className={`${input} w-full`}>
            {CREDENTIAL_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`credentials.kind.${k}`)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={label}>{t("credentials.status")}</label>
          <select name="status" defaultValue="current" className={`${input} w-full`}>
            {CREDENTIAL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`credentials.status.${s}`)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label}>{t("credentials.issuedAt")}</label>
          <input name="issued_at" type="date" className={`${input} w-full`} />
        </div>
        <div>
          <label className={label}>{t("credentials.expiresAt")}</label>
          <input name="expires_at" type="date" className={`${input} w-full`} />
        </div>
      </div>
      <div>
        <label className={label}>{t("credentials.notesOptional")}</label>
        <input name="notes" placeholder={t("credentials.notesPlaceholder")} className={`${input} w-full`} />
      </div>
      {state.error ? <p className="text-xs text-[color:var(--color-danger)]">{state.error}</p> : null}
      <button type="submit" disabled={pending} className={ghostBtn}>
        {pending ? t("credentials.saving") : t("credentials.save")}
      </button>
    </form>
  );
}

function Row({
  memberId,
  row,
  locale,
}: {
  memberId: string;
  row: CredentialRow;
  locale: string;
}) {
  const t = useT();
  const [pending, startTransition] = useTransition();
  return (
    <li className="flex items-center justify-between gap-3 px-5 py-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-ink-100">{t(`credentials.kind.${row.kind}`)}</span>
          <Badge tone={statusTone(row)}>{t(`credentials.status.${row.status}`)}</Badge>
        </div>
        <p className="mt-0.5 text-xs text-ink-500">
          {row.expires_at
            ? t("credentials.expiresOn", { date: shortDate(row.expires_at, locale) })
            : t("credentials.noExpiry")}
          {row.notes ? ` · ${row.notes}` : ""}
        </p>
      </div>
      <button
        onClick={() => startTransition(() => deleteMemberCredential(memberId, row.id))}
        disabled={pending}
        aria-label={t("credentials.remove")}
        className="text-ink-600 transition-colors hover:text-[color:var(--color-danger)] disabled:opacity-40"
      >
        ×
      </button>
    </li>
  );
}

export function MemberCredentialEditor({
  memberId,
  rows,
  locale,
}: {
  memberId: string;
  rows: CredentialRow[];
  locale: string;
}) {
  const t = useT();
  const existingKinds = new Set(rows.map((r) => r.kind));
  return (
    <Card>
      <CardHeader title={t("credentials.title")} sub={t("credentials.sub")} />
      {rows.length === 0 ? (
        <p className="px-5 py-6 text-sm text-ink-500">{t("credentials.none")}</p>
      ) : (
        <ul className="divide-y divide-white/[0.05]">
          {rows.map((r) => (
            <Row key={r.id} memberId={memberId} row={r} locale={locale} />
          ))}
        </ul>
      )}
      <div className="border-t border-white/[0.06]">
        <AddForm memberId={memberId} existingKinds={existingKinds} />
      </div>
    </Card>
  );
}
