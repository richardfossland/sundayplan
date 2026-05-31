/**
 * Public volunteer swap page — `/r/<token>/swap`. No account: token purpose
 * 'swap_request'. Shows SDK-ranked replacements who can cover without a new
 * conflict; the volunteer picks one or hands the slot back to the planner.
 */
import type { Metadata } from "next";
import { loadSwapContext } from "./actions";
import { VolunteerSwap } from "@/components/volunteer-swap";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Find a replacement — SundayPlan",
  robots: { index: false, follow: false },
};

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function formatWhen(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} · ${hh}:${mm}`;
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

export default async function SwapPage({ params }: { params: Promise<{ token: string }> }) {
  const { token: raw } = await params;
  const token = safeDecode(raw);
  const result = await loadSwapContext(token);

  if (!result.ok) {
    return (
      <Frame>
        <div className="rounded-xl border border-white/[0.07] bg-ink-900/60 px-5 py-8 text-center">
          <p className="text-xl font-semibold text-ink-50">This link isn&apos;t valid</p>
          <p className="mt-2 text-sm text-ink-400">Ask your planner for a fresh link.</p>
        </div>
      </Frame>
    );
  }

  const c = result.ctx;
  return (
    <Frame>
      <div className="space-y-6">
        <div className="rounded-xl border border-white/[0.07] bg-ink-900/60 px-5 py-6 text-center">
          <p className="text-sm text-ink-400">Hi {c.volunteer_name}, can&apos;t make</p>
          <p className="mt-1 text-xl font-semibold tracking-tight text-ink-50">{c.role_name}</p>
          <p className="mt-0.5 text-sm text-ink-400">
            {c.service_title} · {formatWhen(c.service_starts_at)}
          </p>
        </div>
        <VolunteerSwap token={token} candidates={c.candidates} />
        <p className="text-center text-xs text-ink-600">No account needed — this link is just for you.</p>
      </div>
    </Frame>
  );
}
