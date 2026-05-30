import Link from "next/link";
import { SectionTitle } from "@/components/ui";
import { getServices } from "@/lib/data/services";

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

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string }>;
}) {
  const { m } = await searchParams;
  const { year, month } = parseMonth(m);

  const all = await getServices();
  // Group services by their UTC calendar date within this month.
  const prefix = `${year}-${pad(month + 1)}`;
  const byDay = new Map<number, typeof all>();
  for (const s of all) {
    if (!s.starts_at_utc.startsWith(prefix)) continue;
    const day = Number(s.starts_at_utc.slice(8, 10));
    const list = byDay.get(day) ?? [];
    list.push(s);
    byDay.set(day, list);
  }

  // Build the calendar grid, Monday-first.
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
          {cells.map((day, i) => (
            <div
              key={i}
              className="min-h-[88px] border-b border-r border-white/[0.04] p-1.5 last:border-r-0"
            >
              {day != null ? (
                <>
                  <div className="mb-1 text-[0.7rem] tabular-nums text-ink-500">{day}</div>
                  <div className="space-y-1">
                    {(byDay.get(day) ?? []).map((s) => (
                      <Link
                        key={s.id}
                        href={`/services/${s.id}`}
                        className="block truncate rounded bg-gold-400/10 px-1.5 py-1 text-[0.7rem] text-gold-200 transition-colors hover:bg-gold-400/20"
                        title={`${s.name} — ${s.starts_at_utc.slice(11, 16)}`}
                      >
                        {s.starts_at_utc.slice(11, 16)} {s.name}
                      </Link>
                    ))}
                  </div>
                </>
              ) : null}
            </div>
          ))}
        </div>
      </div>

      <p className="text-center text-xs text-ink-600">
        Dates shown in UTC (church-local timezone is a follow-up). Tap a service to open it.
      </p>
    </div>
  );
}
