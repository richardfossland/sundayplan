"use client";

import { useState, useTransition } from "react";
import { Badge, Card } from "@/components/ui";
import { loadSwapCandidates, type OpenSwap, type SwapCandidate } from "@/app/(app)/swaps/actions";
import { formatWhenShort } from "@/lib/i18n/date";
import { translate, type Locale } from "@/lib/i18n/messages";

type CandidateState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "loaded"; candidates: SwapCandidate[] }
  | { kind: "error" };

export function SwapQueue({ swaps, locale }: { swaps: OpenSwap[]; locale: Locale }) {
  const t = (key: string, vars?: Record<string, string | number>) => translate(locale, key, vars);

  if (swaps.length === 0) {
    return (
      <Card className="px-5 py-10 text-center">
        <p className="text-sm font-medium text-ink-100">{t("swaps.empty.title")}</p>
        <p className="mt-1 text-xs text-ink-500">{t("swaps.empty.body")}</p>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {swaps.map((s) => (
        <SwapRow key={s.id} swap={s} locale={locale} />
      ))}
    </div>
  );
}

function SwapRow({ swap, locale }: { swap: OpenSwap; locale: Locale }) {
  const t = (key: string, vars?: Record<string, string | number>) => translate(locale, key, vars);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<CandidateState>({ kind: "idle" });
  const [pending, startTransition] = useTransition();

  function toggle() {
    const next = !open;
    setOpen(next);
    // Load candidates lazily the first time the row is expanded.
    if (next && state.kind === "idle") {
      setState({ kind: "loading" });
      startTransition(async () => {
        const r = await loadSwapCandidates(swap.id);
        setState(r.ok ? { kind: "loaded", candidates: r.candidates } : { kind: "error" });
      });
    }
  }

  const whenLabel = swap.service_starts_at ? formatWhenShort(swap.service_starts_at, locale) : "—";

  return (
    <Card>
      <button
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-white/[0.03]"
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-ink-50">{swap.requested_by_name}</span>
            <Badge tone="warning">{t("swaps.badge.open")}</Badge>
          </div>
          <p className="mt-0.5 truncate text-xs text-ink-500">
            {t("swaps.row.context", {
              role: swap.role_name || t("swaps.row.unknownRole"),
              service: swap.service_title || t("swaps.row.unknownService"),
              when: whenLabel,
            })}
          </p>
          {swap.note ? <p className="mt-1 text-xs italic text-ink-400">“{swap.note}”</p> : null}
        </div>
        <span className="shrink-0 text-xs text-ink-500">{open ? t("swaps.hide") : t("swaps.viewCandidates")}</span>
      </button>

      {open ? (
        <div className="border-t border-white/[0.06] px-5 py-4">
          {state.kind === "loading" || pending ? (
            <p className="text-xs text-ink-500">{t("swaps.loadingCandidates")}</p>
          ) : state.kind === "error" ? (
            <p className="text-xs text-[color:var(--color-danger)]">{t("swaps.candidatesError")}</p>
          ) : state.kind === "loaded" && state.candidates.length > 0 ? (
            <>
              <p className="mb-2 text-[0.7rem] font-medium uppercase tracking-wider text-ink-500">
                {t("swaps.candidatesTitle")}
              </p>
              <ul className="space-y-1">
                {state.candidates.map((c) => (
                  <li
                    key={c.member_id}
                    className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 hover:bg-white/[0.04]"
                  >
                    <div className="min-w-0">
                      <span className="text-sm text-ink-100">{c.name}</span>
                      {c.warnings.length > 0 ? (
                        <span className="ml-2 text-[0.7rem] text-[color:var(--color-warning)]">
                          ⚠ {c.warnings.join(", ")}
                        </span>
                      ) : null}
                    </div>
                    <Badge tone="gold">{t("swaps.match", { score: c.score })}</Badge>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-xs text-ink-400">{t("swaps.noCandidates")}</p>
          )}
        </div>
      ) : null}
    </Card>
  );
}
