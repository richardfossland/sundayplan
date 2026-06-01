import { SignOutButton } from "@/components/shell/SignOutButton";
import { CommandPaletteTrigger } from "@/components/shell/CommandPaletteTrigger";

export function TopBar({ userEmail, churchName }: { userEmail: string | null; churchName: string }) {
  const initial = (userEmail?.[0] ?? "?").toUpperCase();
  return (
    <header className="flex h-14 items-center justify-between border-b border-white/[0.06] px-5">
      <div className="flex items-center gap-3">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-royal-500 to-royal-700 text-sm font-bold text-gold-300 shadow-inner">
          S
        </div>
        <span className="text-sm font-semibold tracking-tight text-ink-100">
          Sunday<span className="text-gold-400">Plan</span>
        </span>
        <span className="text-ink-700">/</span>
        <span className="rounded-md px-2 py-1 text-sm text-ink-300">{churchName}</span>
      </div>
      <div className="flex items-center gap-3">
        <CommandPaletteTrigger />
        {userEmail ? <span className="hidden text-xs text-ink-500 sm:inline">{userEmail}</span> : null}
        <SignOutButton />
        <div className="h-7 w-7 rounded-full bg-gradient-to-br from-gold-300 to-gold-600 text-center text-sm font-semibold leading-7 text-ink-950">
          {initial}
        </div>
      </div>
    </header>
  );
}
