/**
 * Public renter status page — `/r/<token>` (Phase 3). Mirrors SundayPlan's RSVP
 * `/r/<token>`: no account required, the signed `booking_status` magic-link token
 * IS the auth. Lives outside the planner shell + is allowlisted in middleware.
 * Mobile-first single screen showing the renter their booking + its status, the
 * church's terms, and (while pending) a cancel control.
 */
import type { Metadata } from "next";
import { loadRenterContext, type LoadError } from "./actions";
import { RenterStatus } from "@/components/renter-status";
import { translate, type Locale } from "@/lib/i18n/messages";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Booking — SundayBooking",
  robots: { index: false, follow: false },
};

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

const ERROR_KEY: Record<LoadError, string> = {
  expired: "renter.err.expired",
  invalid: "renter.err.invalid",
  wrong_purpose: "renter.err.invalid",
  not_found: "renter.err.notFound",
  missing_secret: "renter.err.missingSecret",
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
            Sunday<span className="text-gold-400">Booking</span>
          </span>
        </div>
        {children}
      </div>
    </div>
  );
}

function fmtWhen(iso: string, locale: Locale): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  const date =
    locale === "no"
      ? `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`
      : `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  return `${date} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export default async function RenterStatusPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token: rawToken } = await params;
  const token = safeDecode(rawToken);
  const result = await loadRenterContext(token);

  if (!result.ok) {
    const errLocale: Locale = "no";
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
  const locale = c.locale;

  return (
    <Frame>
      <div className="space-y-6">
        <div className="rounded-xl border border-white/[0.07] bg-ink-900/60 px-5 py-6 text-center">
          <p className="text-sm text-ink-400">{c.church_name}</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight text-ink-50">{c.facility_name}</p>
          <div className="mt-4 border-t border-white/[0.06] pt-4">
            <p className="text-base font-medium text-ink-100">{c.title}</p>
            <p className="mt-0.5 text-sm text-ink-400">
              {fmtWhen(c.starts_at_utc, locale)} – {fmtWhen(c.ends_at_utc, locale)}
            </p>
          </div>
        </div>

        <RenterStatus
          token={token}
          initialStatus={c.status}
          cancellable={c.cancellable}
          locale={locale}
        />

        {c.terms ? (
          <div className="rounded-xl border border-white/[0.07] bg-ink-900/40 px-4 py-3">
            <p className="text-xs font-medium text-ink-300">{translate(locale, "renter.terms")}</p>
            <p className="mt-1 whitespace-pre-wrap text-xs text-ink-500">{c.terms}</p>
          </div>
        ) : null}

        <p className="text-center text-xs text-ink-600">{translate(locale, "renter.noAccount")}</p>
      </div>
    </Frame>
  );
}
