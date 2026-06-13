/**
 * Small UI primitives for SundayBooking, mirroring apps/web/components/ui.tsx's
 * look (ink/royal/gold tokens) so the suite feels consistent. Kept local +
 * minimal — only what the booking screens need.
 */
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

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

type ButtonVariant = "primary" | "ghost" | "danger" | "subtle";

const BTN: Record<ButtonVariant, string> = {
  primary:
    "bg-gradient-to-br from-royal-500 to-royal-700 text-ink-50 hover:from-royal-400 hover:to-royal-600 ring-1 ring-inset ring-white/10",
  ghost: "bg-white/[0.04] text-ink-200 hover:bg-white/[0.08] ring-1 ring-inset ring-white/10",
  subtle: "bg-transparent text-ink-300 hover:bg-white/[0.05]",
  danger:
    "bg-[color:var(--color-danger)]/15 text-[color:var(--color-danger)] hover:bg-[color:var(--color-danger)]/25 ring-1 ring-inset ring-[color:var(--color-danger)]/30",
};

export function Button({
  variant = "primary",
  className = "",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      className={
        "inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium " +
        "transition disabled:cursor-not-allowed disabled:opacity-50 " +
        BTN[variant] +
        " " +
        className
      }
      {...rest}
    >
      {children}
    </button>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-ink-300">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-[0.7rem] text-ink-500">{hint}</span> : null}
    </label>
  );
}

const INPUT =
  "w-full rounded-lg border border-white/10 bg-ink-950/60 px-3 py-1.5 text-sm text-ink-100 " +
  "placeholder:text-ink-600 outline-none focus:border-royal-400/60 focus:ring-1 focus:ring-royal-400/40";

export function Input({ className = "", ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={INPUT + " " + className} {...rest} />;
}

export function Select({
  className = "",
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={INPUT + " " + className} {...rest}>
      {children}
    </select>
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
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.7rem] font-medium ring-1 ring-inset ${TONE[tone]}`}
    >
      {children}
    </span>
  );
}

export const STATUS_TONE: Record<string, Tone> = {
  pending: "warning",
  approved: "success",
  declined: "danger",
  cancelled: "neutral",
};
