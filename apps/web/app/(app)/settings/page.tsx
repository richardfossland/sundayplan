import Link from "next/link";
import { SectionTitle, StatTile, Card, CardHeader } from "@/components/ui";
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
        <SectionTitle eyebrow="Configure">Settings</SectionTitle>
        <p className="text-sm text-ink-500">No church is set up for your account yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SectionTitle eyebrow="Configure">Settings</SectionTitle>

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

      <Card>
        <CardHeader title="Team & roles" sub="Who can do what, and the skill levels auto-fill uses" />
        <div className="flex items-center justify-between px-5 py-4">
          <p className="text-sm text-ink-400">
            Teams, roles and skill levels live in their own section.
          </p>
          <Link
            href="/teams"
            className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-ink-200 transition-colors hover:border-white/25"
          >
            Manage teams →
          </Link>
        </div>
      </Card>
    </div>
  );
}
