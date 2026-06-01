"use client";

/**
 * Volunteer RSVP form — the no-account accept/decline surface (Phase 7).
 *
 * Mobile-first, single-screen. Shows the service + role context (rendered by the
 * server page) and offers Accept / Decline with an optional short note. Submits
 * to the `respond` server action and shows an inline confirmation — the visitor
 * is anonymous, no planner session involved.
 *
 * Copy comes from the shared i18n catalog. These public pages have no
 * I18nProvider, so we call the pure `translate()` with the volunteer's own
 * locale (resolved server-side from member.language and passed as a prop).
 */

import { useState, useTransition } from "react";
import { respond, type RespondOutcome } from "@/app/r/[token]/actions";
import { translate, type Locale } from "@/lib/i18n/messages";

type Phase =
  | { kind: "ask" }
  | { kind: "done"; result: RespondOutcome };

export function RsvpForm({
  token,
  initialStatus,
  respondable,
  locale,
}: {
  token: string;
  initialStatus: string;
  respondable: boolean;
  locale: Locale;
}) {
  const [note, setNote] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "ask" });
  const [pending, startTransition] = useTransition();
  const t = (key: string, vars?: Record<string, string | number>) => translate(locale, key, vars);

  function submit(action: "accept" | "decline") {
    startTransition(async () => {
      const result = await respond(token, action, note);
      setPhase({ kind: "done", result });
    });
  }

  if (phase.kind === "done") {
    return (
      <RsvpDone result={phase.result} locale={locale} onChange={() => setPhase({ kind: "ask" })} />
    );
  }

  if (!respondable) {
    return (
      <Confirmation
        tone="neutral"
        title={t("vol.rsvp.closedTitle")}
        body={t("vol.rsvp.closedBody")}
      />
    );
  }

  const alreadyAccepted = initialStatus === "accepted";
  const alreadyDeclined = initialStatus === "declined";

  return (
    <div className="space-y-5">
      {(alreadyAccepted || alreadyDeclined) && (
        <p className="rounded-lg border border-white/10 bg-ink-900/60 px-4 py-3 text-center text-sm text-ink-300">
          {alreadyAccepted ? t("vol.rsvp.unchangedAccepted") : t("vol.rsvp.unchangedDeclined")}{" "}
          <span className="text-ink-500">{t("vol.rsvp.canStillChange")}</span>
        </p>
      )}

      <p className="text-center text-lg font-medium text-ink-100">{t("vol.rsvp.prompt")}</p>

      <div>
        <label className="mb-1 block text-xs font-medium text-ink-400">
          {t("vol.rsvp.noteLabel")}
        </label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          maxLength={500}
          placeholder={t("vol.rsvp.notePlaceholder")}
          className="w-full rounded-lg border border-white/10 bg-ink-950/60 px-3 py-2 text-sm text-ink-100 outline-none placeholder:text-ink-600 focus:border-gold-400/50"
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => submit("accept")}
          className="rounded-xl bg-gold-400 px-4 py-3 text-base font-semibold text-ink-950 transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {pending ? t("vol.rsvp.saving") : t("vol.rsvp.accept")}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => submit("decline")}
          className="rounded-xl border border-white/15 px-4 py-3 text-base font-semibold text-ink-200 transition-colors hover:border-white/30 disabled:opacity-50"
        >
          {pending ? t("vol.rsvp.saving") : t("vol.rsvp.decline")}
        </button>
      </div>
    </div>
  );
}

function RsvpDone({
  result,
  locale,
  onChange,
}: {
  result: RespondOutcome;
  locale: Locale;
  onChange: () => void;
}) {
  const t = (key: string) => translate(locale, key);
  if (!result.ok) {
    return <Confirmation tone="danger" title={t("vol.rsvp.error")} />;
  }
  switch (result.outcome) {
    case "accepted":
      return (
        <Confirmation
          tone="success"
          title={t("vol.rsvp.acceptedTitle")}
          body={t("vol.rsvp.acceptedBody")}
          onChange={onChange}
          changeLabel={t("vol.rsvp.change")}
        />
      );
    case "declined":
      return (
        <Confirmation
          tone="warning"
          title={t("vol.rsvp.declinedTitle")}
          body={t("vol.rsvp.declinedBody")}
          onChange={onChange}
          changeLabel={t("vol.rsvp.change")}
        />
      );
    case "unchanged":
      return (
        <Confirmation
          tone="neutral"
          title={result.status === "accepted" ? t("vol.rsvp.acceptedTitle") : t("vol.rsvp.declinedTitle")}
          body={
            result.status === "accepted"
              ? t("vol.rsvp.unchangedAccepted")
              : t("vol.rsvp.unchangedDeclined")
          }
          onChange={onChange}
          changeLabel={t("vol.rsvp.change")}
        />
      );
    case "closed":
      return (
        <Confirmation
          tone="neutral"
          title={t("vol.rsvp.closedTitle")}
          body={t("vol.rsvp.closedBody")}
        />
      );
  }
}

function Confirmation({
  tone,
  title,
  body,
  onChange,
  changeLabel,
}: {
  tone: "success" | "warning" | "danger" | "neutral";
  title: string;
  body?: string;
  onChange?: () => void;
  changeLabel?: string;
}) {
  const ring =
    tone === "success"
      ? "ring-[color:var(--color-success)]/40"
      : tone === "warning"
        ? "ring-[color:var(--color-warning)]/40"
        : tone === "danger"
          ? "ring-[color:var(--color-danger)]/40"
          : "ring-white/10";
  return (
    <div className={`rounded-xl border border-white/[0.07] bg-ink-900/60 px-5 py-8 text-center ring-1 ${ring}`}>
      <p className="text-xl font-semibold text-ink-50">{title}</p>
      {body ? <p className="mt-2 text-sm text-ink-400">{body}</p> : null}
      {onChange ? (
        <button
          type="button"
          onClick={onChange}
          className="mt-5 text-sm text-gold-400 underline-offset-4 transition-colors hover:underline"
        >
          {changeLabel}
        </button>
      ) : null}
    </div>
  );
}
