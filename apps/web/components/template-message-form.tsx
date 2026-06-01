"use client";

import { useState } from "react";
import { Card, CardHeader, Badge } from "@/components/ui";
import {
  KNOWN_TEMPLATE_VARIABLES,
  extractVariables,
  formatSms,
  renderTemplate,
} from "@sundayplan/sdk";
import type { MessageTemplate } from "@sundayplan/shared";
import { useT } from "@/lib/i18n/client";

const input =
  "w-full rounded-lg border border-white/10 bg-ink-950/60 px-3 py-2 text-sm text-ink-100 outline-none placeholder:text-ink-600 focus:border-gold-400/50";
const label = "mb-1 block text-xs font-medium text-ink-400";

/** Sample values so the planner sees a realistic preview while editing. */
const SAMPLE: Record<string, string> = {
  volunteer_name: "Maria",
  role_name: "Drums",
  team_name: "Worship",
  service_title: "Sunday Morning",
  service_date: "2026-09-13",
  service_time: "11:00",
  church_name: "Alta Frikirke",
  accept_link: "https://sundayplan.app/r/alta/accept",
  decline_link: "https://sundayplan.app/r/alta/decline",
};

/**
 * Shared template create/edit form with a live preview. Validation is
 * authoritative on the server via the shared Zod schema; the preview here is
 * the same pure SDK renderer the send flow uses, so what you see is what sends.
 */
export function TemplateMessageForm({
  template,
  action,
  submitLabel,
}: {
  template?: Partial<MessageTemplate>;
  action: (formData: FormData) => void;
  submitLabel: string;
}) {
  const t = useT();
  const [channel, setChannel] = useState<MessageTemplate["channel"]>(template?.channel ?? "sms");
  const [subject, setSubject] = useState(template?.subject ?? "");
  const [body, setBody] = useState(template?.body ?? "");

  const render = renderTemplate(body, SAMPLE);
  const vars = extractVariables(body);
  const sms = channel === "sms" ? formatSms(render.text) : null;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <form action={action} className="space-y-4">
        <div>
          <label className={label}>{t("messages.template.name")}</label>
          <input name="name" required defaultValue={template?.name ?? ""} placeholder={t("messages.template.namePlaceholder")} className={input} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label}>{t("messages.form.channel")}</label>
            <select
              name="channel"
              value={channel}
              onChange={(e) => setChannel(e.target.value as MessageTemplate["channel"])}
              className={input}
            >
              <option value="sms">{t("messages.form.channel.sms")}</option>
              <option value="email">{t("messages.form.channel.email")}</option>
              <option value="push">{t("messages.form.channel.push")}</option>
            </select>
          </div>
          <div>
            <label className={label}>{t("messages.form.purpose")}</label>
            <select name="purpose" defaultValue={template?.purpose ?? "custom"} className={input}>
              <option value="invite">{t("messages.purpose.invite")}</option>
              <option value="reminder">{t("messages.purpose.reminder")}</option>
              <option value="final_reminder">{t("messages.purpose.finalReminder")}</option>
              <option value="confirmation">{t("messages.purpose.confirmation")}</option>
              <option value="cancellation">{t("messages.purpose.cancellation")}</option>
              <option value="custom">{t("messages.purpose.custom")}</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label}>{t("messages.template.language")}</label>
            <select name="language" defaultValue={template?.language ?? "no"} className={input}>
              <option value="no">{t("lang.no")}</option>
              <option value="en">{t("lang.en")}</option>
              <option value="sv">{t("lang.sv")}</option>
              <option value="da">{t("lang.da")}</option>
              <option value="de">{t("lang.de")}</option>
              <option value="fr">{t("lang.fr")}</option>
              <option value="pl">{t("lang.pl")}</option>
            </select>
          </div>
          <div>
            <label className={label}>{t("messages.template.status")}</label>
            <select name="is_active" defaultValue={template?.is_active === false ? "false" : "true"} className={input}>
              <option value="true">{t("messages.template.active")}</option>
              <option value="false">{t("messages.template.inactiveOption")}</option>
            </select>
          </div>
        </div>

        {channel !== "sms" ? (
          <div>
            <label className={label}>
              {channel === "push" ? t("messages.template.title") : t("messages.template.subject")}
            </label>
            <input
              name="subject"
              value={subject ?? ""}
              onChange={(e) => setSubject(e.target.value)}
              placeholder={
                channel === "push"
                  ? t("messages.template.titlePlaceholder")
                  : t("messages.template.subjectPlaceholder")
              }
              className={input}
            />
          </div>
        ) : null}

        <div>
          <label className={label}>{t("messages.form.body")}</label>
          <textarea
            name="body"
            rows={6}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t("messages.form.bodyPlaceholder")}
            required
            className={input}
          />
          <p className="mt-1 text-xs text-ink-600">{t("messages.template.bodyHint", { braces: "{{variables}}" })}</p>
        </div>

        <button
          type="submit"
          className="rounded-lg bg-gold-400 px-4 py-2 text-sm font-semibold text-ink-950 transition-opacity hover:opacity-90"
        >
          {submitLabel}
        </button>
      </form>

      <div className="space-y-4">
        <Card>
          <CardHeader
            title={t("messages.template.livePreview", { channel: channel.toUpperCase() })}
            sub={t("messages.template.renderedWith")}
          />
          <div className="px-5 py-4">
            {channel !== "sms" && subject ? (
              <div className="mb-2 font-medium text-ink-100">{renderTemplate(subject, SAMPLE).text}</div>
            ) : null}
            <pre className="whitespace-pre-wrap break-words font-sans text-sm text-ink-200">{render.text || "…"}</pre>
            {sms ? (
              <div className="mt-3 text-xs text-ink-500">
                {sms.segments === 1
                  ? t("messages.template.smsMeta", {
                      characters: sms.characters,
                      encoding: sms.encoding,
                      segments: sms.segments,
                    })
                  : t("messages.template.smsMeta.plural", {
                      characters: sms.characters,
                      encoding: sms.encoding,
                      segments: sms.segments,
                    })}
              </div>
            ) : null}
          </div>
        </Card>

        <Card>
          <CardHeader title={t("messages.template.variables")} sub={t("messages.template.variablesSub")} />
          <div className="px-5 py-4">
            <div className="flex flex-wrap gap-1.5">
              {KNOWN_TEMPLATE_VARIABLES.map((v) => (
                <Badge key={v} tone={vars.known.includes(v) ? "info" : "neutral"}>
                  {`{{${v}}}`}
                </Badge>
              ))}
            </div>
            {vars.unknown.length > 0 ? (
              <p className="mt-3 text-xs text-[color:var(--color-warning)]">
                {t("messages.template.unknown", { vars: vars.unknown.map((u) => `{{${u}}}`).join(", ") })}
              </p>
            ) : null}
          </div>
        </Card>
      </div>
    </div>
  );
}
