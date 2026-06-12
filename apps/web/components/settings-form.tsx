"use client";

import { useActionState, useState } from "react";
import {
  createChurchInvite,
  updateChurchProfile,
  updateChurchSettings,
  type InviteFormState,
  type SettingsFormState,
} from "@/app/(app)/settings/actions";
import type { ChurchProfile } from "@/lib/data/settings";
import { schemas, type ChurchSettings } from "@sundayplan/shared";
import { Card, CardHeader } from "@/components/ui";
import { TabBar } from "@/components/tabs";
import { useT, type TFn } from "@/lib/i18n/client";

const initial: SettingsFormState = { error: null, ok: false };

const input =
  "w-full rounded-lg border border-white/10 bg-ink-950/60 px-3 py-2 text-sm text-ink-100 outline-none placeholder:text-ink-600 focus:border-gold-400/50";
const label = "mb-1 block text-xs font-medium text-ink-400";
const hint = "mt-1 text-xs text-ink-600";
const checkbox = "h-4 w-4 rounded border-white/20 bg-ink-950 text-gold-400";

function Save({ pending, label: l, t }: { pending: boolean; label: string; t: TFn }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-gold-400 px-4 py-2 text-sm font-semibold text-ink-950 transition-opacity hover:opacity-90 disabled:opacity-50"
    >
      {pending ? t("common.saving") : l}
    </button>
  );
}

function Note({ state, t }: { state: SettingsFormState; t: TFn }) {
  if (state.error) return <p className="text-xs text-[color:var(--color-danger)]">{state.error}</p>;
  if (state.ok) return <p className="text-xs text-[color:var(--color-success)]">{t("settings.saved")}</p>;
  return null;
}

const LOCALES: { code: string; name: string }[] = [
  { code: "no", name: "Norsk" },
  { code: "en", name: "English" },
  { code: "sv", name: "Svenska" },
  { code: "da", name: "Dansk" },
  { code: "de", name: "Deutsch" },
  { code: "fr", name: "Français" },
  { code: "pl", name: "Polski" },
];

export function ChurchProfileForm({ church }: { church: ChurchProfile }) {
  const t = useT();
  const [state, action, pending] = useActionState(updateChurchProfile, initial);
  return (
    <Card>
      <CardHeader
        title={t("settings.church.title")}
        sub={t("settings.church.sub", { plan: church.plan_tier, slug: church.slug })}
      />
      <form action={action} className="space-y-4 px-5 py-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={label}>{t("settings.church.name")}</label>
            <input name="name" required defaultValue={church.name} className={input} />
          </div>
          <div>
            <label className={label}>{t("settings.church.denomination")}</label>
            <input
              name="denomination"
              defaultValue={church.denomination ?? ""}
              placeholder={t("settings.church.optional")}
              className={input}
            />
          </div>
          <div>
            <label className={label}>{t("settings.church.language")}</label>
            <select name="locale" defaultValue={church.locale} className={input}>
              {LOCALES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={label}>{t("settings.church.timezone")}</label>
            <input
              name="timezone"
              required
              defaultValue={church.timezone}
              placeholder="Europe/Oslo"
              className={input}
            />
            <p className={hint}>{t("settings.church.timezoneHint")}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Save pending={pending} label={t("settings.church.save")} t={t} />
          <Note state={state} t={t} />
        </div>
      </form>
    </Card>
  );
}

export function VolunteerRulesForm({ settings }: { settings: ChurchSettings }) {
  const t = useT();
  const [state, action, pending] = useActionState(updateChurchSettings, initial);
  const [tab, setTab] = useState("scheduling");
  const c = settings.reminder_cadence ?? { days_before: [], hours_before: [] };
  const rulesTabs = [
    { id: "scheduling", label: t("settings.tab.scheduling") },
    { id: "comms", label: t("settings.tab.comms") },
    { id: "licensing", label: t("settings.tab.licensing") },
  ];
  return (
    <Card>
      <CardHeader title={t("settings.rules.title")} sub={t("settings.rules.sub")} />
      <div className="px-5 pt-3">
        <TabBar tabs={rulesTabs} active={tab} onChange={setTab} />
      </div>
      {/* One form spanning all tabs — inactive panels are hidden, not unmounted,
          so a single Save still persists every field (the action reads them all). */}
      <form action={action} className="space-y-6 px-5 py-5">
        <section className="space-y-3" hidden={tab !== "scheduling"}>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-500">{t("settings.scheduling.heading")}</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className={label}>{t("settings.scheduling.maxAssignments")}</label>
              <input
                name="default_max_assignments_per_month"
                type="number"
                min={1}
                max={31}
                defaultValue={settings.default_max_assignments_per_month}
                className={input}
              />
              <p className={hint}>{t("settings.scheduling.maxAssignments.hint")}</p>
            </div>
            <div>
              <label className={label}>{t("settings.scheduling.unfilledWarn")}</label>
              <input
                name="unfilled_warn_days"
                type="number"
                min={1}
                max={60}
                defaultValue={settings.unfilled_warn_days}
                className={input}
              />
              <p className={hint}>{t("settings.scheduling.unfilledWarn.hint")}</p>
            </div>
            <div>
              <label className={label}>{t("settings.scheduling.maxConsecutive")}</label>
              <input
                name="max_consecutive_sundays"
                type="number"
                min={1}
                max={52}
                defaultValue={settings.max_consecutive_sundays}
                className={input}
              />
              <p className={hint}>{t("settings.scheduling.maxConsecutive.hint")}</p>
            </div>
            <div>
              <label className={label}>{t("settings.scheduling.minRest")}</label>
              <input
                name="min_rest_days"
                type="number"
                min={0}
                max={90}
                defaultValue={settings.min_rest_days}
                className={input}
              />
              <p className={hint}>{t("settings.scheduling.minRest.hint")}</p>
            </div>
          </div>
        </section>

        <section className="space-y-3" hidden={tab !== "comms"}>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-500">{t("settings.comms.heading")}</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={label}>{t("settings.comms.daysBefore")}</label>
              <input
                name="days_before"
                defaultValue={c.days_before.join(", ")}
                placeholder="7, 3, 1"
                className={input}
              />
            </div>
            <div>
              <label className={label}>{t("settings.comms.hoursBefore")}</label>
              <input
                name="hours_before"
                defaultValue={c.hours_before.join(", ")}
                placeholder="1"
                className={input}
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-ink-300">
            <input
              type="checkbox"
              name="auto_buy_sms_overage"
              defaultChecked={settings.auto_buy_sms_overage}
              className={checkbox}
            />
            {t("settings.comms.autoBuySms")}
          </label>
          <label className="flex items-center gap-2 text-sm text-ink-300">
            <input
              type="checkbox"
              name="single_use_response_links"
              defaultChecked={settings.single_use_response_links}
              className={checkbox}
            />
            {t("settings.comms.singleUse")}
          </label>

          <div className="border-t border-white/[0.06] pt-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-500">{t("settings.privacy.heading")}</h3>
            <label className="mt-2 flex items-center gap-2 text-sm text-ink-300">
              <input
                type="checkbox"
                name="ai_consent"
                defaultChecked={settings.ai_consent}
                className={checkbox}
              />
              {t("settings.privacy.aiConsent")}
            </label>
            <p className="mt-1 text-xs text-ink-600">{t("settings.privacy.aiConsent.hint")}</p>
            <a
              href="/api/export"
              className="mt-3 inline-block rounded-lg border border-white/10 bg-ink-950/60 px-3 py-1.5 text-xs font-medium text-ink-200 hover:border-gold-400/40"
            >
              {t("settings.privacy.export")}
            </a>
            <p className="mt-1 text-xs text-ink-600">{t("settings.privacy.export.hint")}</p>
          </div>
        </section>

        <section className="space-y-3" hidden={tab !== "licensing"}>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-500">{t("settings.ccli.heading")}</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={label}>{t("settings.ccli.license")}</label>
              <input
                name="ccli_license_number"
                defaultValue={settings.ccli_license_number ?? ""}
                className={input}
              />
            </div>
            <div>
              <label className={label}>{t("settings.ccli.sizeCategory")}</label>
              <select
                name="ccli_size_category"
                defaultValue={settings.ccli_size_category ?? ""}
                className={input}
              >
                <option value="">—</option>
                {["A", "B", "C", "D", "E", "F"].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-ink-300">
            <input
              type="checkbox"
              name="ccli_streaming_addon"
              defaultChecked={settings.ccli_streaming_addon}
              className={checkbox}
            />
            {t("settings.ccli.streamingAddon")}
          </label>
        </section>

        <section className="space-y-3" hidden={tab !== "licensing"}>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-500">{t("settings.tono.heading")}</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={label}>{t("settings.tono.licenseStatus")}</label>
              <select
                name="tono_license_status"
                defaultValue={settings.tono_license_status}
                className={input}
              >
                <option value="none">{t("settings.tono.status.none")}</option>
                <option value="state_church_blanket">{t("settings.tono.status.state_church_blanket")}</option>
                <option value="direct_agreement">{t("settings.tono.status.direct_agreement")}</option>
                <option value="application_pending">{t("settings.tono.status.application_pending")}</option>
                <option value="not_applicable">{t("settings.tono.status.not_applicable")}</option>
              </select>
            </div>
            <div>
              <label className={label}>{t("settings.tono.customerId")}</label>
              <input
                name="tono_customer_id"
                defaultValue={settings.tono_customer_id ?? ""}
                className={input}
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-ink-300">
            <input
              type="checkbox"
              name="tono_streaming_addon"
              defaultChecked={settings.tono_streaming_addon}
              className={checkbox}
            />
            {t("settings.tono.streamingAddon")}
          </label>
        </section>

        <div className="flex items-center gap-3 border-t border-white/[0.06] pt-4">
          <Save pending={pending} label={t("settings.rules.save")} t={t} />
          <Note state={state} t={t} />
        </div>
      </form>
    </Card>
  );
}

const inviteInitial: InviteFormState = { error: null, link: null, role: null };

/**
 * Mint a single-use church-invite link a planner copy-pastes to a co-planner.
 * Each submit issues a fresh link (single-use), shows it with a Copy button, and
 * never stores the raw link client-side beyond the current result.
 */
export function ChurchInviteForm() {
  const t = useT();
  const [state, action, pending] = useActionState(createChurchInvite, inviteInitial);
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!state.link) return;
    try {
      await navigator.clipboard.writeText(state.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked (insecure context / permissions) — the link is still
      // visible in the field for a manual copy.
    }
  }

  return (
    <Card>
      <CardHeader title={t("settings.invite.title")} sub={t("settings.invite.sub")} />
      <form action={action} className="space-y-4 px-5 py-5">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <div>
            <label className={label}>{t("settings.invite.role")}</label>
            <select name="role" defaultValue="planner" className={input}>
              {schemas.ChurchInviteRole.options.map((r) => (
                <option key={r} value={r}>
                  {schemas.CHURCH_INVITE_ROLE_LABELS[r]}
                </option>
              ))}
            </select>
            <p className={hint}>{t("settings.invite.roleHint")}</p>
          </div>
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-gold-400 px-4 py-2 text-sm font-semibold text-ink-950 transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {pending ? t("common.saving") : t("settings.invite.create")}
          </button>
        </div>
        {state.error ? (
          <p className="text-xs text-[color:var(--color-danger)]">{state.error}</p>
        ) : null}
        {state.link ? (
          <div className="space-y-2 rounded-lg border border-white/10 bg-ink-950/40 p-3">
            <p className="text-xs text-ink-400">
              {t("settings.invite.ready", {
                role: state.role ? schemas.CHURCH_INVITE_ROLE_LABELS[state.role] : "",
              })}
            </p>
            <div className="flex items-center gap-2">
              <input readOnly value={state.link} className={`${input} font-mono text-xs`} />
              <button
                type="button"
                onClick={copy}
                className="shrink-0 rounded-lg border border-white/10 px-3 py-2 text-sm text-ink-200 transition-colors hover:border-white/25"
              >
                {copied ? t("settings.invite.copied") : t("settings.invite.copy")}
              </button>
            </div>
            <p className={hint}>{t("settings.invite.expiryHint")}</p>
          </div>
        ) : null}
      </form>
    </Card>
  );
}
