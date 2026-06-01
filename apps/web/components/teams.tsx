import Link from "next/link";
import type { TeamSummary } from "@/lib/data/teams";
import { getT } from "@/lib/i18n/server";

const FALLBACK_ACCENT = "var(--color-gold-400)";

export async function TeamCard({ team }: { team: TeamSummary }) {
  const accent = team.color ?? FALLBACK_ACCENT;
  const t = await getT();
  return (
    <Link
      href={`/teams/${team.id}`}
      className="group relative block overflow-hidden rounded-xl border border-white/[0.07] bg-ink-900/60 p-5 transition-colors hover:border-white/15"
    >
      <span className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: accent }} />
      <div className="flex items-center gap-2.5">
        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: accent }} />
        <h2 className="text-base font-semibold text-ink-50 group-hover:text-gold-200">{team.name}</h2>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-ink-400">{team.description}</p>
      <div className="mt-4 flex gap-4 text-xs text-ink-500">
        <span><span className="tabular-nums text-ink-200">{team.member_count}</span> {t("teams.members")}</span>
        <span><span className="tabular-nums text-ink-200">{team.role_count}</span> {t("teams.roles")}</span>
      </div>
    </Link>
  );
}
