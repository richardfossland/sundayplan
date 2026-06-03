"use client";

/**
 * Church-invite join surface (Phase 1.3).
 *
 * A planner pasted this link to invite a co-planner. The server page resolved the
 * church + role from the verified token and tells us whether the visitor is
 * already signed in. If they are, one tap creates their `church_member`; if not,
 * we point them at sign-in/sign-up first (carrying the invite path so they bounce
 * back here). Mobile-first single screen, like the RSVP form.
 *
 * These public pages have no I18nProvider, so we call the pure `translate()` with
 * a locale resolved server-side (the inviting church's locale) and passed in.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { joinChurch } from "@/app/r/[token]/join/actions";
import { translate, type Locale } from "@/lib/i18n/messages";

type Phase = "ask" | "joined" | "already" | "error";

export function InviteJoinForm({
  token,
  signedIn,
  signInHref,
  signUpHref,
  locale,
}: {
  token: string;
  signedIn: boolean;
  signInHref: string;
  signUpHref: string;
  locale: Locale;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("ask");
  const [pending, startTransition] = useTransition();
  const t = (key: string, vars?: Record<string, string | number>) => translate(locale, key, vars);

  function accept() {
    startTransition(async () => {
      const res = await joinChurch(token);
      if (!res.ok) {
        setPhase("error");
        return;
      }
      setPhase(res.outcome === "already_member" ? "already" : "joined");
      // Land them in the app once the membership exists.
      router.refresh();
    });
  }

  if (phase === "joined" || phase === "already") {
    return (
      <div className="space-y-4 text-center">
        <p className="text-base text-ink-100">
          {t(phase === "joined" ? "invite.joined" : "invite.alreadyMember")}
        </p>
        <Link
          href="/"
          className="inline-block rounded-lg bg-gold-400 px-4 py-2 text-sm font-semibold text-ink-950 transition-opacity hover:opacity-90"
        >
          {t("invite.go")}
        </Link>
      </div>
    );
  }

  if (phase === "error") {
    return <p className="text-center text-sm text-[color:var(--color-danger)]">{t("invite.error")}</p>;
  }

  if (!signedIn) {
    return (
      <div className="space-y-3">
        <p className="text-center text-sm text-ink-400">{t("invite.signInPrompt")}</p>
        <Link
          href={signInHref}
          className="block w-full rounded-lg bg-gold-400 px-3 py-2 text-center text-sm font-semibold text-ink-950 transition-opacity hover:opacity-90"
        >
          {t("invite.signIn")}
        </Link>
        <Link
          href={signUpHref}
          className="block w-full rounded-lg border border-white/10 px-3 py-2 text-center text-sm font-medium text-ink-100 transition-colors hover:border-gold-400/50"
        >
          {t("invite.createAccount")}
        </Link>
      </div>
    );
  }

  return (
    <button
      type="button"
      disabled={pending}
      onClick={accept}
      className="w-full rounded-lg bg-gold-400 px-3 py-2.5 text-sm font-semibold text-ink-950 transition-opacity hover:opacity-90 disabled:opacity-50"
    >
      {pending ? t("invite.joining") : t("invite.accept")}
    </button>
  );
}
