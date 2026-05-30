"use client";

/**
 * Volunteer RSVP form — the no-account accept/decline surface (Phase 7).
 *
 * Mobile-first, single-screen. Shows the service + role context (rendered by the
 * server page) and offers Accept / Decline with an optional short note. Submits
 * to the `respond` server action and shows an inline confirmation — the visitor
 * is anonymous, no planner session involved.
 *
 * Copy is centralized in `STR` below. Norwegian + English are the launch
 * languages; full i18n (per-volunteer locale) is a follow-up — see DOMAIN.md.
 */

import { useState, useTransition } from "react";
import { respond, type RespondOutcome } from "@/app/r/[token]/actions";

const STR = {
  prompt: "Can you serve?",
  noteLabel: "Add a note (optional)",
  notePlaceholder: "e.g. I can be there a bit early",
  accept: "Yes, I'm in",
  decline: "Sorry, can't",
  change: "Change my answer",
  saving: "Saving…",
  acceptedTitle: "You're in 🎉",
  acceptedBody: "Thanks for serving! We've let your planner know.",
  declinedTitle: "No worries",
  declinedBody: "Thanks for letting us know — your planner will fill the spot.",
  unchangedAccepted: "You're already confirmed for this.",
  unchangedDeclined: "You've already declined this one.",
  closedTitle: "This spot is no longer open",
  closedBody: "Your planner has updated this assignment. Nothing to do here.",
  error: "Something went wrong. Please try the link again.",
} as const;

type Phase =
  | { kind: "ask" }
  | { kind: "done"; result: RespondOutcome };

export function RsvpForm({
  token,
  initialStatus,
  respondable,
}: {
  token: string;
  initialStatus: string;
  respondable: boolean;
}) {
  const [note, setNote] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "ask" });
  const [pending, startTransition] = useTransition();

  function submit(action: "accept" | "decline") {
    startTransition(async () => {
      const result = await respond(token, action, note);
      setPhase({ kind: "done", result });
    });
  }

  if (phase.kind === "done") {
    return <RsvpDone result={phase.result} onChange={() => setPhase({ kind: "ask" })} />;
  }

  if (!respondable) {
    return (
      <Confirmation tone="neutral" title={STR.closedTitle} body={STR.closedBody} />
    );
  }

  const alreadyAccepted = initialStatus === "accepted";
  const alreadyDeclined = initialStatus === "declined";

  return (
    <div className="space-y-5">
      {(alreadyAccepted || alreadyDeclined) && (
        <p className="rounded-lg border border-white/10 bg-ink-900/60 px-4 py-3 text-center text-sm text-ink-300">
          {alreadyAccepted ? STR.unchangedAccepted : STR.unchangedDeclined}{" "}
          <span className="text-ink-500">You can still change it below.</span>
        </p>
      )}

      <p className="text-center text-lg font-medium text-ink-100">{STR.prompt}</p>

      <div>
        <label className="mb-1 block text-xs font-medium text-ink-400">{STR.noteLabel}</label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          maxLength={500}
          placeholder={STR.notePlaceholder}
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
          {pending ? STR.saving : STR.accept}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => submit("decline")}
          className="rounded-xl border border-white/15 px-4 py-3 text-base font-semibold text-ink-200 transition-colors hover:border-white/30 disabled:opacity-50"
        >
          {pending ? STR.saving : STR.decline}
        </button>
      </div>
    </div>
  );
}

function RsvpDone({ result, onChange }: { result: RespondOutcome; onChange: () => void }) {
  if (!result.ok) {
    return <Confirmation tone="danger" title={STR.error} />;
  }
  switch (result.outcome) {
    case "accepted":
      return (
        <Confirmation tone="success" title={STR.acceptedTitle} body={STR.acceptedBody} onChange={onChange} />
      );
    case "declined":
      return (
        <Confirmation tone="warning" title={STR.declinedTitle} body={STR.declinedBody} onChange={onChange} />
      );
    case "unchanged":
      return (
        <Confirmation
          tone="neutral"
          title={result.status === "accepted" ? STR.acceptedTitle : STR.declinedTitle}
          body={result.status === "accepted" ? STR.unchangedAccepted : STR.unchangedDeclined}
          onChange={onChange}
        />
      );
    case "closed":
      return <Confirmation tone="neutral" title={STR.closedTitle} body={STR.closedBody} />;
  }
}

function Confirmation({
  tone,
  title,
  body,
  onChange,
}: {
  tone: "success" | "warning" | "danger" | "neutral";
  title: string;
  body?: string;
  onChange?: () => void;
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
          {STR.change}
        </button>
      ) : null}
    </div>
  );
}
