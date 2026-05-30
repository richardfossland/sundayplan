"use client";

import { useActionState } from "react";
import {
  updateChurchProfile,
  updateChurchSettings,
  type SettingsFormState,
} from "@/app/(app)/settings/actions";
import type { ChurchProfile } from "@/lib/data/settings";
import type { ChurchSettings } from "@sundayplan/shared";
import { Card, CardHeader } from "@/components/ui";

const initial: SettingsFormState = { error: null, ok: false };

const input =
  "w-full rounded-lg border border-white/10 bg-ink-950/60 px-3 py-2 text-sm text-ink-100 outline-none placeholder:text-ink-600 focus:border-gold-400/50";
const label = "mb-1 block text-xs font-medium text-ink-400";
const hint = "mt-1 text-xs text-ink-600";
const checkbox = "h-4 w-4 rounded border-white/20 bg-ink-950 text-gold-400";

function Save({ pending, label: l }: { pending: boolean; label: string }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-gold-400 px-4 py-2 text-sm font-semibold text-ink-950 transition-opacity hover:opacity-90 disabled:opacity-50"
    >
      {pending ? "Saving…" : l}
    </button>
  );
}

function Note({ state }: { state: SettingsFormState }) {
  if (state.error) return <p className="text-xs text-[color:var(--color-danger)]">{state.error}</p>;
  if (state.ok) return <p className="text-xs text-[color:var(--color-success)]">Saved.</p>;
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
  const [state, action, pending] = useActionState(updateChurchProfile, initial);
  return (
    <Card>
      <CardHeader title="Church" sub={`Plan: ${church.plan_tier} · /${church.slug}`} />
      <form action={action} className="space-y-4 px-5 py-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={label}>Name</label>
            <input name="name" required defaultValue={church.name} className={input} />
          </div>
          <div>
            <label className={label}>Denomination</label>
            <input
              name="denomination"
              defaultValue={church.denomination ?? ""}
              placeholder="optional"
              className={input}
            />
          </div>
          <div>
            <label className={label}>Language</label>
            <select name="locale" defaultValue={church.locale} className={input}>
              {LOCALES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={label}>Timezone (IANA)</label>
            <input
              name="timezone"
              required
              defaultValue={church.timezone}
              placeholder="Europe/Oslo"
              className={input}
            />
            <p className={hint}>Used for service times and reports.</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Save pending={pending} label="Save church" />
          <Note state={state} />
        </div>
      </form>
    </Card>
  );
}

export function VolunteerRulesForm({ settings }: { settings: ChurchSettings }) {
  const [state, action, pending] = useActionState(updateChurchSettings, initial);
  const c = settings.reminder_cadence ?? { days_before: [], hours_before: [] };
  return (
    <Card>
      <CardHeader
        title="Volunteer rules, reminders & licensing"
        sub="Drives auto-fill caps, the conflict engine, reminder cadence, and TONO/CCLI reporting."
      />
      <form action={action} className="space-y-6 px-5 py-5">
        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-500">Scheduling</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className={label}>Max assignments / month</label>
              <input
                name="default_max_assignments_per_month"
                type="number"
                min={1}
                max={31}
                defaultValue={settings.default_max_assignments_per_month}
                className={input}
              />
              <p className={hint}>Church default; a member can override.</p>
            </div>
            <div>
              <label className={label}>Unfilled-slot warning (days)</label>
              <input
                name="unfilled_warn_days"
                type="number"
                min={1}
                max={60}
                defaultValue={settings.unfilled_warn_days}
                className={input}
              />
              <p className={hint}>Warn when a slot is still open this close to the service.</p>
            </div>
            <div>
              <label className={label}>Max consecutive Sundays</label>
              <input
                name="max_consecutive_sundays"
                type="number"
                min={1}
                max={52}
                defaultValue={settings.max_consecutive_sundays}
                className={input}
              />
              <p className={hint}>Flag burnout past this many in a row.</p>
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-500">Reminders</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={label}>Days before (comma-separated)</label>
              <input
                name="days_before"
                defaultValue={c.days_before.join(", ")}
                placeholder="7, 3, 1"
                className={input}
              />
            </div>
            <div>
              <label className={label}>Hours before</label>
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
            Auto-buy SMS overage when the quota runs out
          </label>
          <label className="flex items-center gap-2 text-sm text-ink-300">
            <input
              type="checkbox"
              name="single_use_response_links"
              defaultChecked={settings.single_use_response_links}
              className={checkbox}
            />
            Single-use response links (a tap locks the link; off = change-of-mind allowed)
          </label>
        </section>

        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-500">CCLI</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={label}>CCLI license number</label>
              <input
                name="ccli_license_number"
                defaultValue={settings.ccli_license_number ?? ""}
                className={input}
              />
            </div>
            <div>
              <label className={label}>Size category</label>
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
            CCLI streaming add-on
          </label>
        </section>

        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-500">TONO</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={label}>License status</label>
              <select
                name="tono_license_status"
                defaultValue={settings.tono_license_status}
                className={input}
              >
                <option value="none">None</option>
                <option value="state_church_blanket">State-church blanket</option>
                <option value="direct_agreement">Direct agreement</option>
                <option value="application_pending">Application pending</option>
                <option value="not_applicable">Not applicable</option>
              </select>
            </div>
            <div>
              <label className={label}>TONO customer id</label>
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
            TONO streaming add-on (separate royalty pool)
          </label>
        </section>

        <div className="flex items-center gap-3 border-t border-white/[0.06] pt-4">
          <Save pending={pending} label="Save settings" />
          <Note state={state} />
        </div>
      </form>
    </Card>
  );
}
