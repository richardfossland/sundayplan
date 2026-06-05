import type { ReactNode } from "react";
import Link from "next/link";
import { Sparkles } from "lucide-react";

/**
 * Reusable first-run empty state. SaaS-onboarding research: a blank screen with
 * no guidance is abandoned by most users — so every empty state names what will
 * appear here and gives exactly one clear next action.
 */
export function EmptyState({
  icon = <Sparkles className="h-5 w-5" strokeWidth={1.75} aria-hidden />,
  title,
  blurb,
  cta,
  secondary,
}: {
  icon?: ReactNode;
  title: string;
  blurb: string;
  cta?: { label: string; href: string };
  secondary?: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-md rounded-xl border border-dashed border-white/[0.1] bg-ink-900/40 px-8 py-12 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-gold-400/10 text-xl text-gold-300">
        {icon}
      </div>
      <h3 className="mt-4 text-base font-semibold text-ink-50">{title}</h3>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-ink-400">{blurb}</p>
      {cta ? (
        <Link
          href={cta.href}
          className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-gold-400/90 px-4 py-2 text-sm font-medium text-ink-950 transition-colors hover:bg-gold-400"
        >
          {cta.label}
        </Link>
      ) : null}
      {secondary ? <div className="mt-3">{secondary}</div> : null}
    </div>
  );
}
