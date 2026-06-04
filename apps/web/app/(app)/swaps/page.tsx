import { SectionTitle } from "@/components/ui";
import { SwapQueue } from "@/components/swap-queue";
import { createClient } from "@/lib/supabase/server";
import { listOpenSwaps } from "@/lib/data/swap";
import { getT, getLocale } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export default async function SwapsPage() {
  const [t, locale] = await Promise.all([getT(), getLocale()]);
  const supabase = await createClient();
  const swaps = await listOpenSwaps(supabase);

  return (
    <div className="space-y-6">
      <SectionTitle eyebrow={t("swaps.eyebrow")}>{t("swaps.title")}</SectionTitle>
      <p className="max-w-2xl text-sm text-ink-400">{t("swaps.intro")}</p>
      <SwapQueue swaps={swaps} locale={locale} />
      <p className="text-center text-xs text-ink-600">{t("swaps.footer")}</p>
    </div>
  );
}
