import Link from "next/link";
import { SectionTitle } from "@/components/ui";
import { PeopleTable } from "@/components/people";
import {
  PeopleFilters,
  applyPeopleFilter,
  type PeopleFilter,
} from "@/components/people-filters";
import { getPeople } from "@/lib/data/people";
import { getT } from "@/lib/i18n/server";

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; team?: string; tag?: string }>;
}) {
  const t = await getT();
  const sp = await searchParams;
  const filter: PeopleFilter = {
    q: sp.q ?? "",
    status: sp.status ?? "",
    team: sp.team ?? "",
    tag: sp.tag ?? "",
  };

  const people = await getPeople();
  const teams = [...new Set(people.flatMap((p) => p.teams))].sort();
  const tags = [...new Set(people.flatMap((p) => p.tags))].sort();
  const filtered = applyPeopleFilter(people, filter);
  const active = filtered.filter((p) => p.status === "active").length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <SectionTitle eyebrow={t("people.eyebrowRegistry")}>{t("people.title")}</SectionTitle>
        <div className="flex items-center gap-4">
          <span className="text-sm text-ink-500">
            {t("people.countSummary", {
              active,
              shown: filtered.length,
              total: people.length,
            })}
          </span>
          <Link
            href="/people/holiday"
            className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-ink-200 transition-colors hover:border-white/25"
          >
            {t("people.holiday")}
          </Link>
          <Link
            href="/people/import"
            className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-ink-200 transition-colors hover:border-white/25"
          >
            {t("people.import")}
          </Link>
          <Link
            href="/people/new"
            className="rounded-lg bg-gold-400 px-3 py-1.5 text-sm font-semibold text-ink-950 transition-opacity hover:opacity-90"
          >
            {t("people.addPerson")}
          </Link>
        </div>
      </div>
      <PeopleFilters filter={filter} teams={teams} tags={tags} />
      {filtered.length === 0 ? (
        <p className="py-12 text-center text-sm text-ink-500">{t("people.emptyFiltered")}</p>
      ) : (
        <PeopleTable people={filtered} />
      )}
    </div>
  );
}
