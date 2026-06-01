import Link from "next/link";
import { SectionTitle, StatTile, Card, CardHeader } from "@/components/ui";
import { ChurchProfileForm, VolunteerRulesForm } from "@/components/settings-form";
import { getChurchProfile, getChurchSettings } from "@/lib/data/settings";
import { getT } from "@/lib/i18n/server";

export default function Page() {
  return <SettingsBody />;
}

async function SettingsBody() {
  const t = await getT();
  const [church, settings] = await Promise.all([getChurchProfile(), getChurchSettings()]);

  if (!church || !settings) {
    return (
      <div className="space-y-2">
        <SectionTitle eyebrow={t("settings.eyebrow")}>{t("settings.title")}</SectionTitle>
        <p className="text-sm text-ink-500">{t("settings.noChurch")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SectionTitle eyebrow={t("settings.eyebrow")}>{t("settings.title")}</SectionTitle>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label={t("settings.stat.plan")} value={church.plan_tier} />
        <StatTile label={t("settings.stat.smsUsed")} value={settings.sms_quota_used} hint={t("settings.stat.smsUsed.hint")} />
        <StatTile
          label={t("settings.stat.tono")}
          value={settings.tono_license_status === "none" ? "—" : t("settings.stat.tono.linked")}
          tone={settings.tono_license_status === "none" ? "neutral" : "gold"}
        />
        <StatTile
          label={t("settings.stat.ccli")}
          value={settings.ccli_license_number ? settings.ccli_size_category ?? t("settings.stat.ccli.set") : "—"}
        />
      </div>

      <ChurchProfileForm church={church} />
      <VolunteerRulesForm settings={settings} />

      <Card>
        <CardHeader title={t("settings.team.title")} sub={t("settings.team.sub")} />
        <div className="flex items-center justify-between px-5 py-4">
          <p className="text-sm text-ink-400">
            {t("settings.team.blurb")}
          </p>
          <Link
            href="/teams"
            className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-ink-200 transition-colors hover:border-white/25"
          >
            {t("settings.team.manage")}
          </Link>
        </div>
      </Card>
    </div>
  );
}
