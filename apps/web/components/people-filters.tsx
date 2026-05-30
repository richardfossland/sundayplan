import Link from "next/link";
import type { PersonRow } from "@/lib/data/people";

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

export function PeopleFilters({
  filter,
  teams,
  tags,
}: {
  filter: PeopleFilter;
  teams: string[];
  tags: string[];
}) {
  const active = filter.q || filter.status || filter.team || filter.tag;
  return (
    <form method="GET" className="flex flex-wrap items-end gap-2">
      <input name="q" defaultValue={filter.q} placeholder="Search name…" className={control} />
      <select name="status" defaultValue={filter.status} className={control}>
        <option value="">Any status</option>
        <option value="active">Active</option>
        <option value="inactive">Inactive</option>
        <option value="archived">Archived</option>
      </select>
      <select name="team" defaultValue={filter.team} className={control}>
        <option value="">Any team</option>
        {teams.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      <select name="tag" defaultValue={filter.tag} className={control}>
        <option value="">Any tag</option>
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
        Filter
      </button>
      {active ? (
        <Link href="/people" className="self-center text-sm text-ink-500 hover:text-ink-300">
          Clear
        </Link>
      ) : null}
    </form>
  );
}
