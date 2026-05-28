import { SectionTitle } from "@/components/ui";
import { PeopleTable } from "@/components/people";
import { buildPeople } from "@/lib/mock";

export default function PeoplePage() {
  const people = buildPeople();
  const active = people.filter((p) => p.status === "active").length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <SectionTitle eyebrow="Registry">People</SectionTitle>
        <span className="text-sm text-ink-500">
          {active} active · {people.length} total
        </span>
      </div>
      <PeopleTable people={people} />
      <p className="text-center text-xs text-ink-600">
        Phone is the highest-value field — SMS magic links are how volunteers respond. Bulk import + filters land with the backend.
      </p>
    </div>
  );
}
