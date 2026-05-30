/**
 * Public volunteer response page (Phase 7) — `/r/<token>`.
 *
 * No planner account required: the signed magic-link token IS the auth. This
 * route lives OUTSIDE the `(app)` group (so it skips the planner shell + auth
 * gate) and is allowlisted in middleware. Mobile-first single screen: it shows
 * the service, date/time, role, and church, then offers Accept / Decline.
 *
 * If `?do=accept|decline` is present (the one-tap links from the SMS/email), we
 * could auto-apply, but we deliberately render the choice first so a misclicked
 * link or a link-preview crawler doesn't silently change a volunteer's answer —
 * the buttons carry the action through the client form instead.
 */
import type { Metadata } from "next";
import { loadResponseContext, type LoadError } from "./actions";
import { RsvpForm } from "@/components/rsvp-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Respond — SundayPlan",
  robots: { index: false, follow: false },
};

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function formatWhen(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} · ${hh}:${mm}`;
}

const ERROR_COPY: Record<LoadError, { title: string; body: string }> = {
  expired: {
    title: "This link has expired",
    body: "Ask your planner to send you a fresh invitation.",
  },
  invalid: {
    title: "This link isn't valid",
    body: "It may have been mistyped or truncated. Open it again from your original message.",
  },
  wrong_purpose: {
    title: "This link isn't valid",
    body: "Open it again from your original invitation message.",
  },
  not_found: {
    title: "We couldn't find this assignment",
    body: "It may have been changed or removed. Check with your planner.",
  },
  missing_secret: {
    title: "Responses aren't available right now",
    body: "This SundayPlan isn't configured to accept link responses yet.",
  },
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

export default async function RespondPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token: rawToken } = await params;
  // Next.js already URL-decodes dynamic segments; real JWTs are URL-safe so this
  // is a no-op for them, but stay defensive against a re-encoded link.
  const token = safeDecode(rawToken);
  const result = await loadResponseContext(token);

  if (!result.ok) {
    const copy = ERROR_COPY[result.error];
    return (
      <Frame>
        <div className="rounded-xl border border-white/[0.07] bg-ink-900/60 px-5 py-8 text-center">
          <p className="text-xl font-semibold text-ink-50">{copy.title}</p>
          <p className="mt-2 text-sm text-ink-400">{copy.body}</p>
        </div>
      </Frame>
    );
  }

  const c = result.context;

  return (
    <Frame>
      <div className="space-y-6">
        <div className="rounded-xl border border-white/[0.07] bg-ink-900/60 px-5 py-6 text-center">
          <p className="text-sm text-ink-400">
            Hi {c.volunteer_name}, {c.church_name} would like you on
          </p>
          <p className="mt-1 text-2xl font-semibold tracking-tight text-ink-50">{c.role_name}</p>
          {c.team_name ? <p className="text-sm text-ink-500">{c.team_name}</p> : null}
          <div className="mt-4 border-t border-white/[0.06] pt-4">
            <p className="text-base font-medium text-ink-100">{c.service_title}</p>
            <p className="mt-0.5 text-sm text-ink-400">{formatWhen(c.service_starts_at)}</p>
          </div>
        </div>

        <RsvpForm token={token} initialStatus={c.status} respondable={c.respondable} />

        <p className="text-center text-xs text-ink-600">
          No account needed — this link is just for you.
        </p>
      </div>
    </Frame>
  );
}
