"use client";

import { useState, useTransition } from "react";
import { proposeReplacement, leaveOpen } from "@/app/r/[token]/swap/actions";

interface Candidate {
  member_id: string;
  name: string;
  score: number;
  warnings: string[];
}

export function VolunteerSwap({ token, candidates }: { token: string; candidates: Candidate[] }) {
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState<null | "proposed" | "open">(null);
  const [error, setError] = useState<string | null>(null);

  function ask(memberId: string) {
    setError(null);
    startTransition(async () => {
      const r = await proposeReplacement(token, memberId);
      if (r.ok) setDone("proposed");
      else setError(r.error ?? "Something went wrong");
    });
  }
  function handBack() {
    setError(null);
    startTransition(async () => {
      const r = await leaveOpen(token);
      if (r.ok) setDone("open");
      else setError(r.error ?? "Something went wrong");
    });
  }

  if (done) {
    return (
      <div className="rounded-xl border border-white/[0.07] bg-ink-900/60 px-5 py-8 text-center">
        <p className="text-xl font-semibold text-ink-50">
          {done === "proposed" ? "Thanks — we've asked them" : "Done — your planner will cover it"}
        </p>
        <p className="mt-2 text-sm text-ink-400">
          {done === "proposed"
            ? "We've sent the slot to your suggested replacement and let your planner know."
            : "We've taken you off this slot and flagged it for your planner."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {candidates.length > 0 ? (
        <div className="rounded-xl border border-white/[0.07] bg-ink-900/60 p-2">
          <p className="px-3 py-2 text-xs font-medium uppercase tracking-wider text-ink-500">
            Best people to cover
          </p>
          <ul className="space-y-1">
            {candidates.map((c) => (
              <li key={c.member_id} className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 hover:bg-white/[0.04]">
                <div className="min-w-0">
                  <span className="text-sm text-ink-100">{c.name}</span>
                  {c.warnings.length > 0 ? (
                    <span className="ml-2 text-[0.7rem] text-[color:var(--color-warning)]">⚠ {c.warnings.join(", ")}</span>
                  ) : null}
                </div>
                <button
                  onClick={() => ask(c.member_id)}
                  disabled={pending}
                  className="shrink-0 rounded-md bg-white/[0.06] px-3 py-1 text-xs text-ink-100 transition-colors hover:bg-gold-400/90 hover:text-ink-950 disabled:opacity-40"
                >
                  Ask {c.name.split(" ")[0]}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-white/[0.1] px-5 py-6 text-center text-sm text-ink-400">
          No one else is free for this slot — hand it back and your planner will sort it.
        </div>
      )}

      {error ? <p className="text-center text-xs text-[color:var(--color-danger)]">{error}</p> : null}

      <button
        onClick={handBack}
        disabled={pending}
        className="w-full rounded-lg border border-white/10 px-4 py-2.5 text-sm text-ink-200 transition-colors hover:border-white/25 disabled:opacity-40"
      >
        I can&apos;t — leave it for my planner
      </button>
    </div>
  );
}
