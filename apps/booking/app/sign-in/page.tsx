/**
 * Sign-in landing (Phase 0). SundayBooking shares the SundaySuite session via
 * the cross-subdomain cookie (NEXT_PUBLIC_COOKIE_DOMAIN), so in production a
 * planner already signed in at plan.sundaysuite.app is signed in here too. This
 * minimal page is the fallback when there is no shared session yet; the rich
 * magic-link / password form (reusing @sundayplan/auth) lands in a later phase.
 */
import Link from "next/link";
import { getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

const SIGN_IN_URL =
  process.env.NEXT_PUBLIC_PLAN_URL ?? "https://plan.sundaysuite.app/sign-in";

export default async function SignInPage() {
  const t = await getT();
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center justify-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-gradient-to-br from-royal-500 to-royal-700 text-base font-bold text-gold-300">
            S
          </div>
          <span className="text-lg font-semibold tracking-tight text-ink-100">
            Sunday<span className="text-gold-400">Booking</span>
          </span>
        </div>
        <div className="rounded-xl border border-white/[0.07] bg-ink-900/60 p-6 text-center">
          <h1 className="text-lg font-semibold text-ink-50">
            {t("auth.signin.title")}
          </h1>
          <p className="mt-1 text-sm text-ink-500">{t("auth.signin.sub")}</p>
          <Link
            href={SIGN_IN_URL}
            className="mt-5 inline-block w-full rounded-lg bg-gold-400 px-3 py-2 text-sm font-semibold text-ink-950 transition-opacity hover:opacity-90"
          >
            {t("auth.signin.cta")}
          </Link>
        </div>
      </div>
    </main>
  );
}
