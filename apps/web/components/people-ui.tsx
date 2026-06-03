import type { PersonRow } from "@/lib/data/people";
import { Badge } from "@/components/ui";
import { formatCalendarShort } from "@/lib/i18n/date";

/**
 * Client-safe people presentation helpers. Kept free of any server-only
 * imports (e.g. `lib/i18n/server`, which reaches into `next/headers`) so that
 * client components such as `team-composition.tsx` can use them without
 * dragging the server boundary into a client bundle. The server-rendered
 * `PeopleTable` lives in `people.tsx`.
 */

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
