import Link from "next/link";
import { Badge, Card, SectionTitle } from "@/components/ui";
import { getSongs, getSongThemes, STALE_DAYS } from "@/lib/data/songs";
import { getT } from "@/lib/i18n/server";

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function lastUsedLabel(iso: string | null, never: string): string {
  if (!iso) return never;
  const d = new Date(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

const LANGS = [
  { value: "no", label: "Norsk" },
  { value: "en", label: "English" },
  { value: "sv", label: "Svenska" },
  { value: "da", label: "Dansk" },
  { value: "de", label: "Deutsch" },
  { value: "fr", label: "Français" },
  { value: "pl", label: "Polski" },
];

const input =
  "rounded-lg border border-white/10 bg-ink-950/60 px-3 py-2 text-sm text-ink-100 outline-none placeholder:text-ink-600 focus:border-gold-400/50";

export default async function SongsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; theme?: string; language?: string; stale?: string }>;
}) {
  const t = await getT();
  const sp = await searchParams;
  const filters = {
    q: sp.q || undefined,
    theme: sp.theme || undefined,
    language: sp.language || undefined,
    stale: sp.stale === "1",
  };
  const [songs, themes] = await Promise.all([getSongs(filters), getSongThemes()]);
  const hasFilters = Boolean(filters.q || filters.theme || filters.language || filters.stale);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <SectionTitle eyebrow={t("songs.eyebrow")}>{t("songs.title")}</SectionTitle>
        <div className="flex items-center gap-4">
          <span className="text-sm text-ink-500">{t("songs.shown", { count: songs.length })}</span>
          <Link
            href="/songs/new"
            className="rounded-lg bg-gold-400 px-3 py-1.5 text-sm font-semibold text-ink-950 transition-opacity hover:opacity-90"
          >
            {t("songs.add")}
          </Link>
        </div>
      </div>

      <form method="GET" className="flex flex-wrap items-center gap-3">
        <input name="q" defaultValue={filters.q ?? ""} placeholder={t("songs.searchPlaceholder")} className={`${input} min-w-[200px] flex-1`} />
        <select name="theme" defaultValue={filters.theme ?? ""} className={input}>
          <option value="">{t("songs.allThemes")}</option>
          {themes.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select name="language" defaultValue={filters.language ?? ""} className={input}>
          <option value="">{t("songs.allLanguages")}</option>
          {LANGS.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-ink-300">
          <input type="checkbox" name="stale" value="1" defaultChecked={filters.stale} className="accent-gold-400" />
          {t("songs.staleFilter", { weeks: STALE_DAYS / 7 })}
        </label>
        <button type="submit" className="rounded-lg border border-white/10 px-3 py-2 text-sm text-ink-200 transition-colors hover:border-white/25">
          {t("songs.filter")}
        </button>
        {hasFilters ? (
          <Link href="/songs" className="text-sm text-ink-500 hover:text-ink-300">
            {t("songs.clear")}
          </Link>
        ) : null}
      </form>

      {songs.length === 0 ? (
        <Card className="px-5 py-10 text-center text-sm text-ink-500">
          {hasFilters ? t("songs.empty.filtered") : t("songs.empty.none")}
        </Card>
      ) : (
        <div className="space-y-2">
          {songs.map((s) => (
            <Link key={s.id} href={`/songs/${s.id}`} className="block">
              <Card className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 transition-colors hover:border-white/20">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-ink-100">{s.title}</span>
                    {s.default_key ? <Badge tone="gold">{s.default_key}</Badge> : null}
                    <Badge>{s.language}</Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-ink-500">
                    {s.author ?? t("songs.unknownAuthor")}
                    {s.themes.length > 0 ? <span className="text-ink-600"> · {s.themes.join(", ")}</span> : null}
                  </p>
                </div>
                <div className="text-right text-xs text-ink-500">
                  <p>{t("songs.lastUsed", { date: lastUsedLabel(s.last_used_at, t("songs.never")) })}</p>
                  <p className="text-ink-600">
                    {s.usage_count === 1
                      ? t("songs.serviceCount.one", { count: s.usage_count })
                      : t("songs.serviceCount.other", { count: s.usage_count })}
                  </p>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <p className="text-center text-xs text-ink-600">
        {t("songs.footerNote")}
      </p>
    </div>
  );
}
