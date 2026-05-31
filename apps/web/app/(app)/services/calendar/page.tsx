import Link from "next/link";
import { SectionTitle } from "@/components/ui";
import { getServices, type ServiceSummary } from "@/lib/data/services";
import { getChurchProfile } from "@/lib/data/settings";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function parseMonth(m: string | undefined): { year: number; month: number } {
  const match = /^(\d{4})-(\d{2})$/.exec(m ?? "");
  if (match) return { year: Number(match[1]), month: Number(match[2]) - 1 };
  const now = new Date();
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() };
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function shift(year: number, month: number, by: number): string {
  const idx = year * 12 + month + by;
  return `${Math.floor(idx / 12)}-${pad((idx % 12) + 1)}`;
}

// A service's calendar date depends on the church's timezone, not UTC — an
// 11pm-UTC Saturday service in Oslo is Sunday locally. We bucket by the local
// Y-M-D and render the local time on the chip.
interface LocalParts {
  year: number;
  month: number; // 1-based
  day: number;
  time: string; // "HH:mm"
}

function makeLocalParts(timezone: string) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return (iso: string): LocalParts => {
    const parts = fmt.formatToParts(new Date(iso));
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
    return {
      year: Number(get("year")),
      month: Number(get("month")),
      day: Number(get("day")),
      time: `${get("hour")}:${get("minute")}`,
    };
  };
}

// Chip colour by coverage so a planner spots under-staffed Sundays at a glance.
function chipClass(s: ServiceSummary): string {
  if (s.required_roles != null) {
    return s.filled_roles >= s.required_roles
      ? "bg-[color:var(--color-success)]/15 text-[color:var(--color-success)] hover:bg-[color:var(--color-success)]/25"
      : "bg-[color:var(--color-warning)]/15 text-[color:var(--color-warning)] hover:bg-[color:var(--color-warning)]/25";
  }
  return "bg-gold-400/10 text-gold-200 hover:bg-gold-400/20";
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string }>;
}) {
  const { m } = await searchParams;
  const { year, month } = parseMonth(m);

  const [all, profile] = await Promise.all([getServices(), getChurchProfile()]);
  const timezone = profile?.timezone ?? "UTC";
  const toLocal = makeLocalParts(timezone);

  // Group services by their local calendar day within the displayed month.
  const byDay = new Map<number, { s: ServiceSummary; time: string }[]>();
  for (const s of all) {
    const lp = toLocal(s.starts_at_utc);
    if (lp.year !== year || lp.month !== month + 1) continue;
    const list = byDay.get(lp.day) ?? [];
    list.push({ s, time: lp.time });
    byDay.set(lp.day, list);
  }

  // Calendar grid, Monday-first.
  const firstWeekday = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <SectionTitle eyebrow="Services">
          {MONTHS[month]} {year}
        </SectionTitle>
        <div className="flex items-center gap-2 text-sm">
          <Link
            href={`/services/calendar?m=${shift(year, month, -1)}`}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-ink-200 transition-colors hover:border-white/25"
          >
            ← Prev
          </Link>
          <Link href="/services/calendar" className="text-ink-500 hover:text-ink-300">
            Today
          </Link>
          <Link
            href={`/services/calendar?m=${shift(year, month, 1)}`}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-ink-200 transition-colors hover:border-white/25"
          >
            Next →
          </Link>
          <Link
            href="/services"
            className="ml-2 rounded-lg border border-white/10 px-3 py-1.5 text-ink-200 transition-colors hover:border-white/25"
          >
            List view
          </Link>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-white/[0.07] bg-ink-900/40">
        <div className="grid grid-cols-7 border-b border-white/[0.07] text-xs font-medium uppercase tracking-wider text-ink-500">
          {WEEKDAYS.map((w) => (
            <div key={w} className="px-3 py-2">
              {w}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((day, i) => {
            const dateStr = day != null ? `${year}-${pad(month + 1)}-${pad(day)}` : "";
            return (
              <div
                key={i}
                className="group/day relative min-h-[88px] border-b border-r border-white/[0.04] p-1.5 last:border-r-0"
              >
                {day != null ? (
                  <>
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-[0.7rem] tabular-nums text-ink-500">{day}</span>
                      <Link
                        href={`/services/new?date=${dateStr}`}
                        title="New service this day"
                        className="text-[0.7rem] leading-none text-ink-600 opacity-0 transition-opacity hover:text-gold-300 group-hover/day:opacity-100"
                      >
                        +
                      </Link>
                    </div>
                    <div className="space-y-1">
                      {(byDay.get(day) ?? []).map(({ s, time }) => (
                        <Link
                          key={s.id}
                          href={`/services/${s.id}`}
                          className={`block truncate rounded px-1.5 py-1 text-[0.7rem] transition-colors ${chipClass(s)}`}
                          title={`${s.name} — ${time}${
                            s.required_roles != null ? ` · ${s.filled_roles}/${s.required_roles} roles` : ""
                          }`}
                        >
                          {time} {s.name}
                        </Link>
                      ))}
                    </div>
                  </>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <p className="text-center text-xs text-ink-600">
        Times shown in {timezone}. Green = fully staffed, amber = roles still open. Tap a day&apos;s{" "}
        <span className="text-ink-400">+</span> to plan a new service.
      </p>
    </div>
  );
}
