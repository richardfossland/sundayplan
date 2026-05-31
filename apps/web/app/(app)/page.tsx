import Link from "next/link";
import { SectionTitle, StatTile, Card, CardHeader, Badge } from "@/components/ui";
import { ConflictPanel } from "@/components/dashboard";
import { OnboardingChecklist } from "@/components/onboarding-checklist";
import { EmptyState } from "@/components/empty-state";
import { getDashboard } from "@/lib/data/dashboard";
import { getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [d, t] = await Promise.all([getDashboard(), getT()]);

  // First run: nothing to summarise yet — guide the user toward first value.
  if (d.totals.services === 0 && d.totals.members === 0) {
    return (
      <div className="space-y-8">
        <SectionTitle eyebrow={t("dash.welcome")}>{t("dash.welcomeTitle")}</SectionTitle>
        <OnboardingChecklist checklist={d.checklist} />
        <EmptyState
          icon="📅"
          title={t("dash.ready.title")}
          blurb={t("dash.ready.blurb")}
          cta={{ label: t("dash.ready.cta"), href: "/teams/new" }}
        />
      </div>
    );
  }

  const filled = d.nextService?.filled_roles ?? 0;
  const required = d.nextService?.required_roles ?? null;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SectionTitle eyebrow={t("dash.nextService")}>
          {d.nextService ? d.nextService.name : t("dash.noUpcoming")}
        </SectionTitle>
        {d.nextServiceWhen ? (
          <span className="text-sm text-ink-400">{d.nextServiceWhen}</span>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          label={t("dash.stat.rolesFilled")}
          value={required != null ? `${filled}/${required}` : filled}
          hint={d.nextService ? t("dash.stat.rolesFilled.hint") : "—"}
        />
        <StatTile
          label={t("dash.stat.pending")}
          value={d.pendingRsvps}
          tone={d.pendingRsvps > 0 ? "warning" : "neutral"}
          hint={t("dash.stat.pending.hint")}
        />
        <StatTile
          label={t("dash.stat.openSlots")}
          value={d.openSlots}
          tone={d.openSlots > 0 ? "warning" : "neutral"}
          hint={t("dash.stat.openSlots.hint")}
        />
        <StatTile
          label={t("dash.stat.conflicts")}
          value={d.hardConflicts}
          tone={d.hardConflicts > 0 ? "danger" : "neutral"}
          hint={t("dash.stat.conflicts.hint")}
        />
      </div>

      {!d.checklist.complete ? <OnboardingChecklist checklist={d.checklist} /> : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title={t("dash.nextService")}
            sub={d.nextService ? t("dash.nextCard.coverage") : t("dash.nextCard.empty")}
            action={
              required != null ? (
                <Badge tone={filled >= required ? "success" : "warning"}>
                  {t("dash.nextCard.roles", { filled, required })}
                </Badge>
              ) : undefined
            }
          />
          <div className="px-5 py-4">
            {d.nextService ? (
              <>
                <p className="text-sm text-ink-200">{d.nextService.name}</p>
                {d.nextServiceWhen ? (
                  <p className="mt-0.5 text-xs text-ink-500">{d.nextServiceWhen}</p>
                ) : null}
                <div className="mt-4 flex flex-wrap gap-2">
                  <Link
                    href={`/services/${d.nextService.id}`}
                    className="rounded-lg bg-white/[0.06] px-3 py-1.5 text-sm text-ink-100 transition-colors hover:bg-white/[0.1]"
                  >
                    {t("dash.openService")}
                  </Link>
                  <Link
                    href="/schedule"
                    className="rounded-lg bg-gold-400/90 px-3 py-1.5 text-sm font-medium text-ink-950 transition-colors hover:bg-gold-400"
                  >
                    {t("dash.scheduleVolunteers")}
                  </Link>
                </div>
              </>
            ) : (
              <EmptyState
                icon="📅"
                title={t("dash.noService.title")}
                blurb={t("dash.noService.blurb")}
                cta={{ label: t("dash.noService.cta"), href: "/services/new" }}
              />
            )}
          </div>
        </Card>

        <ConflictPanel conflicts={d.conflicts} roleNames={d.roleNames} memberNames={d.memberNames} t={t} />
      </div>
    </div>
  );
}
