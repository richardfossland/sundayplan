import { SectionTitle, StatTile } from "@/components/ui";
import { ChurchProfileForm, VolunteerRulesForm } from "@/components/settings-form";
import { getChurchProfile, getChurchSettings } from "@/lib/data/settings";

export default function Page() {
  return <SettingsBody />;
}

async function SettingsBody() {
  const [church, settings] = await Promise.all([getChurchProfile(), getChurchSettings()]);

  if (!church || !settings) {
    return (
      <div className="space-y-2">
        <SectionTitle eyebrow="Phase 4.3">Settings</SectionTitle>
        <p className="text-sm text-ink-500">No church is set up for your account yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SectionTitle eyebrow="Phase 4.3">Settings</SectionTitle>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Plan" value={church.plan_tier} />
        <StatTile label="SMS used" value={settings.sms_quota_used} hint="this period" />
        <StatTile
          label="TONO"
          value={settings.tono_license_status === "none" ? "—" : "linked"}
          tone={settings.tono_license_status === "none" ? "neutral" : "gold"}
        />
        <StatTile
          label="CCLI"
          value={settings.ccli_license_number ? settings.ccli_size_category ?? "set" : "—"}
        />
      </div>

      <ChurchProfileForm church={church} />
      <VolunteerRulesForm settings={settings} />
    </div>
  );
}
