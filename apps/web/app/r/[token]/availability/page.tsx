/**
 * Public volunteer blockout page — `/r/<token>/availability`. No account: the
 * magic-link token (purpose 'availability_set') is the auth. Lets a volunteer
 * mark the dates they can't serve so they're left out of auto-fill — the
 * Planning Center "blockout dates" pattern, Doodle-simple.
 */
import type { Metadata } from "next";
import { loadAvailabilityContext } from "./actions";
import { VolunteerAvailabilityForm } from "@/components/volunteer-availability-form";
import { translate } from "@/lib/i18n/messages";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Your availability — SundayPlan",
  robots: { index: false, follow: false },
};

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

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

export default async function AvailabilityPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token: raw } = await params;
  const token = safeDecode(raw);
  const result = await loadAvailabilityContext(token);

  if (!result.ok) {
    // No verified member here, so fall back to the default locale.
    return (
      <Frame>
        <div className="rounded-xl border border-white/[0.07] bg-ink-900/60 px-5 py-8 text-center">
          <p className="text-xl font-semibold text-ink-50">
            {translate("no", "vol.avail.invalidTitle")}
          </p>
          <p className="mt-2 text-sm text-ink-400">{translate("no", "vol.avail.invalidBody")}</p>
        </div>
      </Frame>
    );
  }

  const locale = result.locale;

  return (
    <Frame>
      <div className="space-y-6">
        <div className="rounded-xl border border-white/[0.07] bg-ink-900/60 px-5 py-6 text-center">
          <p className="text-sm text-ink-400">
            {translate(locale, "vol.avail.greeting", { name: result.memberName })}
          </p>
          <p className="mt-1 text-xl font-semibold tracking-tight text-ink-50">
            {translate(locale, "vol.avail.heading")}
          </p>
          <p className="mt-2 text-sm text-ink-400">{translate(locale, "vol.avail.sub")}</p>
        </div>

        <VolunteerAvailabilityForm token={token} blockouts={result.blockouts} locale={locale} />

        <p className="text-center text-xs text-ink-600">{translate(locale, "vol.noAccount")}</p>
      </div>
    </Frame>
  );
}
