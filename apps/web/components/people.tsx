import Link from "next/link";
import type { PersonRow } from "@/lib/data/people";
import { Badge } from "@/components/ui";
import { getT, getLocale } from "@/lib/i18n/server";
import { formatCalendarShort } from "@/lib/i18n/date";

/** Short calendar date, e.g. "5. jan." (no) or "5 Jan" (en). Locale defaults to "no". */
export function shortDate(iso: string | null, locale = "no"): string {
  if (!iso) return "—";
  return formatCalendarShort(iso, locale);
}

const SKILL_TONE = { trainer: "gold", lead: "gold", capable: "info", training: "neutral" } as const;
const STATUS_TONE = { active: "success", inactive: "warning", archived: "neutral" } as const;

export function SkillBadge({ skill }: { skill: PersonRow["skill"] }) {
  return <Badge tone={SKILL_TONE[skill]}>{skill}</Badge>;
}

export function StatusBadge({ status }: { status: PersonRow["status"] }) {
  return <Badge tone={STATUS_TONE[status]}>{status}</Badge>;
}

export async function PeopleTable({ people }: { people: PersonRow[] }) {
  const [t, locale] = await Promise.all([getT(), getLocale()]);
  return (
    <div className="overflow-x-auto rounded-xl border border-white/[0.07] bg-ink-900/40">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-white/[0.07] text-left text-xs font-medium uppercase tracking-wider text-ink-500">
            <th className="px-4 py-3">{t("people.colName")}</th>
            <th className="px-4 py-3">{t("people.colTeams")}</th>
            <th className="px-4 py-3">{t("people.colSkill")}</th>
            <th className="px-4 py-3">{t("people.lastServed")}</th>
            <th className="px-4 py-3">{t("people.colStatus")}</th>
            <th className="px-4 py-3">{t("people.contact")}</th>
          </tr>
        </thead>
        <tbody>
          {people.map((p) => (
            <tr key={p.id} className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02]">
              <td className="px-4 py-3">
                <Link href={`/people/${p.id}`} className="font-medium text-ink-100 underline-offset-4 hover:text-gold-300 hover:underline">
                  {p.name}
                </Link>
              </td>
              <td className="px-4 py-3 text-ink-400">{p.teams.join(", ")}</td>
              <td className="px-4 py-3"><SkillBadge skill={p.skill} /></td>
              <td className="px-4 py-3 tabular-nums text-ink-400">{shortDate(p.last_served, locale)}</td>
              <td className="px-4 py-3"><StatusBadge status={p.status} /></td>
              <td className="px-4 py-3 text-ink-500">
                {p.phone ? <span className="font-mono text-xs">{p.phone}</span> : <span className="text-ink-600">{t("people.noPhone")}</span>}
                <span className="ml-2 text-[0.7rem] uppercase text-ink-600">{p.channel}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
