/**
 * Church-invite accept page (Phase 1.3) — `/r/<token>/join`.
 *
 * A planner mints an invite link (church + role) and copy-pastes it to a future
 * co-planner. This route lives OUTSIDE the `(app)` group (and `/r/` is
 * allowlisted in middleware) so an invitee with no session can reach it. We
 * verify the token, show the church + role, and:
 *   • signed in  → one tap creates their `church_member` (the join action);
 *   • signed out → send them to sign-in / sign-up carrying the invite path so
 *                  they bounce straight back here afterwards.
 *
 * Unlike the volunteer RSVP page, the invitee DOES get an account — they become a
 * planner-side member, not a no-account volunteer.
 */
import type { Metadata } from "next";
import { loadInviteContext, type InviteLoadError } from "@/lib/data/invites";
import { createClient } from "@/lib/supabase/server";
import { InviteJoinForm } from "@/components/invite-join-form";
import { schemas } from "@sundayplan/shared";
import { translate, isLocale, DEFAULT_LOCALE, type Locale } from "@/lib/i18n/messages";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Join — SundayPlan",
  robots: { index: false, follow: false },
};

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

const ERROR_KEY: Record<InviteLoadError, string> = {
  expired: "invite.err.expired",
  invalid: "invite.err.invalid",
  wrong_purpose: "invite.err.invalid",
  not_found: "invite.err.notFound",
  spent: "invite.err.spent",
  missing_secret: "invite.err.missingSecret",
};

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-7 flex items-center justify-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-gradient-to-br from-royal-500 to-royal-700 text-base font-bold text-gold-300">
            S
          </div>
          <span className="text-lg font-semibold tracking-tight text-ink-100">
            Sunday<span className="text-gold-400">Plan</span>
          </span>
        </div>
        {children}
      </div>
    </div>
  );
}

export default async function JoinPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token: rawToken } = await params;
  const token = safeDecode(rawToken);
  const result = await loadInviteContext(token);

  if (!result.ok) {
    const errLocale: Locale = DEFAULT_LOCALE;
    const base = ERROR_KEY[result.error];
    return (
      <Frame>
        <div className="rounded-xl border border-white/[0.07] bg-ink-900/60 px-5 py-8 text-center">
          <p className="text-xl font-semibold text-ink-50">{translate(errLocale, `${base}.title`)}</p>
          <p className="mt-2 text-sm text-ink-400">{translate(errLocale, `${base}.body`)}</p>
        </div>
      </Frame>
    );
  }

  const c = result.context;
  const locale: Locale = isLocale(c.locale) ? c.locale : DEFAULT_LOCALE;
  const roleLabel = schemas.CHURCH_INVITE_ROLE_LABELS[c.role];

  // Is the invitee already signed in? If so they can join in one tap.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const signedIn = Boolean(user);

  // Bounce-back path so sign-in/up returns the invitee to this exact link.
  const next = encodeURIComponent(`/r/${encodeURIComponent(token)}/join`);

  return (
    <Frame>
      <div className="space-y-6">
        <div className="rounded-xl border border-white/[0.07] bg-ink-900/60 px-5 py-6 text-center">
          <p className="text-sm text-ink-400">{translate(locale, "invite.intro")}</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight text-ink-50">{c.church_name}</p>
          <div className="mt-4 border-t border-white/[0.06] pt-4">
            <p className="text-sm text-ink-400">
              {translate(locale, "invite.role", { role: roleLabel })}
            </p>
          </div>
        </div>

        <InviteJoinForm
          token={token}
          signedIn={signedIn}
          signInHref={`/sign-in?next=${next}`}
          signUpHref={`/sign-up?next=${next}`}
          locale={locale}
        />
      </div>
    </Frame>
  );
}
