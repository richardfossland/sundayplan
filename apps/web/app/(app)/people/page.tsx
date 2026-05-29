import Link from "next/link";
import { SectionTitle } from "@/components/ui";
import { PeopleTable } from "@/components/people";
import { getPeople } from "@/lib/data/people";

export default async function PeoplePage() {
  const people = await getPeople();
  const active = people.filter((p) => p.status === "active").length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <SectionTitle eyebrow="Registry">People</SectionTitle>
        <div className="flex items-center gap-4">
          <span className="text-sm text-ink-500">
            {active} active · {people.length} total
          </span>
          <Link
            href="/people/new"
            className="rounded-lg bg-gold-400 px-3 py-1.5 text-sm font-semibold text-ink-950 transition-opacity hover:opacity-90"
          >
            + Add person
          </Link>
        </div>
      </div>
      <PeopleTable people={people} />
      <p className="text-center text-xs text-ink-600">
        Phone is the highest-value field — SMS magic links are how volunteers respond. Bulk import + filters land next.
      </p>
    </div>
  );
}
