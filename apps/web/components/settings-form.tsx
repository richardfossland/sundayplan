"use client";

import { useActionState, useState } from "react";
import {
  updateChurchProfile,
  updateChurchSettings,
  type SettingsFormState,
} from "@/app/(app)/settings/actions";
import type { ChurchProfile } from "@/lib/data/settings";
import type { ChurchSettings } from "@sundayplan/shared";
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
