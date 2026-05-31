"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, CardHeader, Badge } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import type { DashboardChecklist } from "@/lib/data/dashboard";

interface Step {
  key: keyof Omit<DashboardChecklist, "complete">;
  labelKey: string;
  hintKey: string;
  href: string;
}

const STEPS: Step[] = [
  { key: "hasTeam", labelKey: "onb.step.team", hintKey: "onb.step.team.hint", href: "/teams/new" },
  { key: "hasRole", labelKey: "onb.step.role", hintKey: "onb.step.role.hint", href: "/teams" },
  { key: "hasMembers", labelKey: "onb.step.people", hintKey: "onb.step.people.hint", href: "/people/new" },
  { key: "hasService", labelKey: "onb.step.service", hintKey: "onb.step.service.hint", href: "/services/new" },
  { key: "hasMessage", labelKey: "onb.step.invite", hintKey: "onb.step.invite.hint", href: "/schedule" },
];

/**
 * First-run momentum checklist (SaaS onboarding best practice). Shows the
 * shortest path to first value; auto-hides once every step is done, and can be
 * dismissed early (remembered per browser).
 */
export function OnboardingChecklist({ checklist }: { checklist: DashboardChecklist }) {
  const [dismissed, setDismissed] = useState(false);
  const t = useT();
  if (checklist.complete || dismissed) return null;

  const done = STEPS.filter((s) => checklist[s.key]).length;

  return (
    <Card>
      <CardHeader
        title={t("onb.title")}
        sub={t("onb.sub")}
        action={<Badge tone="gold">{done}/{STEPS.length}</Badge>}
      />
      <ul className="divide-y divide-white/[0.05]">
        {STEPS.map((step) => {
          const complete = checklist[step.key];
          return (
            <li key={step.key} className="flex items-center gap-3 px-5 py-3">
              <span
                className={
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[0.7rem] " +
                  (complete
                    ? "bg-[color:var(--color-success)]/20 text-[color:var(--color-success)]"
                    : "border border-white/15 text-ink-600")
                }
              >
                {complete ? "✓" : ""}
              </span>
              <div className="min-w-0 flex-1">
                <span className={complete ? "text-sm text-ink-500 line-through" : "text-sm text-ink-100"}>
                  {t(step.labelKey)}
                </span>
                <span className="ml-2 text-xs text-ink-600">{t(step.hintKey)}</span>
              </div>
              {!complete ? (
                <Link
                  href={step.href}
                  className="shrink-0 rounded-md bg-white/[0.06] px-2.5 py-1 text-xs text-ink-200 transition-colors hover:bg-white/[0.1] hover:text-ink-50"
                >
                  {t("onb.start")}
                </Link>
              ) : null}
            </li>
          );
        })}
      </ul>
      <div className="flex justify-end border-t border-white/[0.06] px-5 py-2.5">
        <button
          onClick={() => setDismissed(true)}
          className="text-xs text-ink-600 transition-colors hover:text-ink-300"
        >
          {t("onb.dismiss")}
        </button>
      </div>
    </Card>
  );
}
