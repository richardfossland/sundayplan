import Link from "next/link";
import type { PersonRow } from "@/lib/data/people";
import { getT } from "@/lib/i18n/server";

export interface PeopleFilter {
  q: string;
  status: string; // "" = any
  team: string; // "" = any
  tag: string; // "" = any
}

/** Apply the filter bar's selections to an already-fetched people list. */
export function applyPeopleFilter(people: PersonRow[], f: PeopleFilter): PersonRow[] {
  const q = f.q.trim().toLowerCase();
  return people.filter((p) => {
    if (q && !p.name.toLowerCase().includes(q)) return false;
    if (f.status && p.status !== f.status) return false;
    if (f.team && !p.teams.includes(f.team)) return false;
    if (f.tag && !p.tags.includes(f.tag)) return false;
    return true;
  });
}

const control =
  "rounded-lg border border-white/10 bg-ink-950/60 px-3 py-2 text-sm text-ink-100 outline-none focus:border-gold-400/50";

export async function PeopleFilters({
  filter,
  teams,
  tags,
}: {
  filter: PeopleFilter;
  teams: string[];
  tags: string[];
}) {
  const t = await getT();
  const active = filter.q || filter.status || filter.team || filter.tag;
  return (
    <form method="GET" className="flex flex-wrap items-end gap-2">
      <input name="q" defaultValue={filter.q} placeholder={t("people.searchNamePlaceholder")} className={control} />
      <select name="status" defaultValue={filter.status} className={control}>
        <option value="">{t("people.anyStatus")}</option>
        <option value="active">{t("people.statusActive")}</option>
        <option value="inactive">{t("people.statusInactive")}</option>
        <option value="archived">{t("people.statusArchived")}</option>
      </select>
      <select name="team" defaultValue={filter.team} className={control}>
        <option value="">{t("people.anyTeam")}</option>
        {teams.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      <select name="tag" defaultValue={filter.tag} className={control}>
        <option value="">{t("people.anyTag")}</option>
        {tags.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      <button
        type="submit"
        className="rounded-lg border border-white/10 px-3 py-2 text-sm text-ink-200 transition-colors hover:border-white/25"
      >
        {t("people.filter")}
      </button>
      {active ? (
        <Link href="/people" className="self-center text-sm text-ink-500 hover:text-ink-300">
          {t("people.clear")}
        </Link>
      ) : null}
    </form>
  );
}
