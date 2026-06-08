import type { ReactNode } from "react";
import type { ScoreBreakdown } from "@sundayplan/shared";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={
        "rounded-xl border border-white/[0.07] bg-ink-900/60 backdrop-blur-sm " +
        "shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset,0_8px_30px_-12px_rgba(0,0,0,0.6)] " +
        className
      }
    >
      {children}
    </div>
  );
}

export function CardHeader({ title, sub, action }: { title: string; sub?: string; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-white/[0.06] px-5 py-4">
      <div>
        <h2 className="text-sm font-semibold tracking-tight text-ink-50">{title}</h2>
        {sub ? <p className="mt-0.5 text-xs text-ink-500">{sub}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function SectionTitle({ children, eyebrow }: { children: ReactNode; eyebrow?: string }) {
  return (
    <div>
      {eyebrow ? (
        <div className="mb-1 text-[0.7rem] font-medium uppercase tracking-[0.18em] text-gold-400/80">{eyebrow}</div>
      ) : null}
      <h1 className="text-2xl font-semibold tracking-tight text-ink-50">{children}</h1>
    </div>
  );
}

type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "gold";

const TONE: Record<Tone, string> = {
  neutral: "bg-white/[0.06] text-ink-300 ring-white/10",
  success: "bg-[color:var(--color-success)]/15 text-[color:var(--color-success)] ring-[color:var(--color-success)]/30",
  warning: "bg-[color:var(--color-warning)]/15 text-[color:var(--color-warning)] ring-[color:var(--color-warning)]/30",
  danger: "bg-[color:var(--color-danger)]/15 text-[color:var(--color-danger)] ring-[color:var(--color-danger)]/30",
  info: "bg-[color:var(--color-info)]/15 text-[color:var(--color-info)] ring-[color:var(--color-info)]/30",
  gold: "bg-gold-400/15 text-gold-300 ring-gold-400/30",
};

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: Tone }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.7rem] font-medium ring-1 ring-inset ${TONE[tone]}`}>
      {children}
    </span>
  );
}

export function StatTile({ label, value, hint, tone = "neutral", icon }: { label: string; value: ReactNode; hint?: string; tone?: Tone; icon?: ReactNode }) {
  const accent = tone === "danger" ? "text-[color:var(--color-danger)]" : tone === "warning" ? "text-[color:var(--color-warning)]" : tone === "gold" ? "text-gold-300" : "text-ink-50";
  return (
    <Card className="px-5 py-4">
      <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-ink-500">
        {icon ? <span className={`shrink-0 ${accent}`}>{icon}</span> : null}
        {label}
      </div>
      <div className={`mt-2 text-3xl font-semibold tabular-nums ${accent}`}>{value}</div>
      {hint ? <div className="mt-1 text-xs text-ink-500">{hint}</div> : null}
    </Card>
  );
}

// Color per scoring component — keeps the stacked bar readable at a glance.
const COMP_COLOR: Record<string, string> = {
  skill_match: "var(--color-royal-400)",
  rotation_fairness: "var(--color-gold-400)",
  frequency_balance: "var(--color-info)",
  pairing: "var(--color-success)",
  variety: "var(--color-ink-400)",
  custom: "var(--color-ink-600)",
  availability: "var(--color-ink-500)",
  burnout: "var(--color-danger)",
};

const COMP_LABEL: Record<string, string> = {
  skill_match: "Skill",
  rotation_fairness: "Rotation",
  frequency_balance: "Frequency",
  pairing: "Pairing",
  variety: "Variety",
  custom: "Custom",
  burnout: "Burnout",
};

export function ScoreBar({ score }: { score: ScoreBreakdown }) {
  const positives = score.components.filter((c) => c.contribution > 0);
  const denom = positives.reduce((s, c) => s + c.contribution, 0) || 1;
  return (
    <div className="w-full">
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-white/[0.05]">
        {positives.map((c) => (
          <div
            key={c.name}
            style={{ width: `${(c.contribution / denom) * 100}%`, backgroundColor: COMP_COLOR[c.name] ?? "var(--color-ink-500)" }}
            title={`${COMP_LABEL[c.name] ?? c.name}: +${c.contribution.toFixed(1)} — ${c.explanation}`}
          />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {positives.map((c) => (
          <span key={c.name} className="inline-flex items-center gap-1.5 text-[0.7rem] text-ink-400">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: COMP_COLOR[c.name] ?? "var(--color-ink-500)" }} />
            {COMP_LABEL[c.name] ?? c.name}
            <span className="tabular-nums text-ink-500">+{c.contribution.toFixed(0)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export function PlaceholderPage({ title, blurb, phase }: { title: string; blurb: string; phase: string }) {
  return (
    <div className="mx-auto max-w-2xl py-16 text-center">
      <SectionTitle eyebrow={phase}>{title}</SectionTitle>
      <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-ink-400">{blurb}</p>
      <div className="keyline mx-auto mt-8 w-16" />
    </div>
  );
}
