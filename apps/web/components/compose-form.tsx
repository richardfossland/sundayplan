"use client";

import { useState, useTransition } from "react";
import { Card, CardHeader, Badge } from "@/components/ui";
import {
  formatSms,
  resolveRecipients,
  type PerRecipientValues,
  type ResolvableMember,
} from "@sundayplan/sdk";
import type { MessageChannel } from "@sundayplan/shared";
import { sendServiceMessage } from "@/app/(app)/messages/actions";
import { loadServiceRecipients, type RecipientPreview } from "@/app/(app)/messages/compose/preview";
import type { ComposeService, TemplateListItem } from "@/lib/data/comms";
import { useT } from "@/lib/i18n/client";

const input =
  "w-full rounded-lg border border-white/10 bg-ink-950/60 px-3 py-2 text-sm text-ink-100 outline-none placeholder:text-ink-600 focus:border-gold-400/50";
const label = "mb-1 block text-xs font-medium text-ink-400";

const SKIP_KEYS = new Set(["no_phone", "no_email", "no_push_token", "no_usable_channel"]);

/**
 * Compose + preview + send flow. The preview resolves recipients in the browser
 * using the SAME pure SDK functions the server send uses, over recipient data
 * fetched for the chosen service — so the preview list matches exactly what the
 * server will send via the stub provider.
 */
export function ComposeForm({
  services,
  templates,
}: {
  services: ComposeService[];
  templates: TemplateListItem[];
}) {
  const t = useT();
  const [serviceId, setServiceId] = useState(services[0]?.id ?? "");
  const [templateId, setTemplateId] = useState("");
  const [channel, setChannel] = useState<MessageChannel | "preferred">("preferred");
  const [purpose, setPurpose] = useState("custom");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [recipients, setRecipients] = useState<RecipientPreview | null>(null);
  const [loading, startLoading] = useTransition();

  function applyTemplate(id: string) {
    setTemplateId(id);
    const t = templates.find((x) => x.id === id);
    if (t) {
      setChannel(t.channel);
      setPurpose(t.purpose);
      setSubject(t.subject ?? "");
      setBody(t.body);
    }
  }

  function loadRecipients(id: string) {
    if (!id) {
      setRecipients(null);
      return;
    }
    startLoading(async () => {
      setRecipients(await loadServiceRecipients(id));
    });
  }

  // Resolve the preview from already-loaded recipient data — pure, no network.
  const resolved =
    recipients && body.trim() !== ""
      ? resolveRecipients(
          body,
          recipients.members as ResolvableMember[],
          recipients.values as PerRecipientValues,
          { channel, subject },
        )
      : null;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <form action={sendServiceMessage} className="space-y-4">
        <input type="hidden" name="template_id" value={templateId} />
        <div>
          <label className={label}>{t("messages.form.service")}</label>
          <select
            name="service_id"
            value={serviceId}
            onChange={(e) => {
              setServiceId(e.target.value);
              loadRecipients(e.target.value);
            }}
            className={input}
            required
          >
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        {templates.length > 0 ? (
          <div>
            <label className={label}>{t("messages.form.startFromTemplate")}</label>
            <select value={templateId} onChange={(e) => applyTemplate(e.target.value)} className={input}>
              <option value="">{t("messages.form.none")}</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.channel})
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label}>{t("messages.form.channel")}</label>
            <select
              name="channel"
              value={channel}
              onChange={(e) => setChannel(e.target.value as MessageChannel | "preferred")}
              className={input}
            >
              <option value="preferred">{t("messages.form.channel.preferred")}</option>
              <option value="sms">{t("messages.form.channel.sms")}</option>
              <option value="email">{t("messages.form.channel.email")}</option>
              <option value="push">{t("messages.form.channel.push")}</option>
            </select>
          </div>
          <div>
            <label className={label}>{t("messages.form.purpose")}</label>
            <select name="purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)} className={input}>
              <option value="invite">{t("messages.purpose.invite")}</option>
              <option value="reminder">{t("messages.purpose.reminder")}</option>
              <option value="final_reminder">{t("messages.purpose.finalReminder")}</option>
              <option value="confirmation">{t("messages.purpose.confirmation")}</option>
              <option value="cancellation">{t("messages.purpose.cancellation")}</option>
              <option value="custom">{t("messages.purpose.custom")}</option>
            </select>
          </div>
        </div>

        {channel !== "sms" ? (
          <div>
            <label className={label}>{t("messages.form.subjectTitle")}</label>
            <input name="subject" value={subject} onChange={(e) => setSubject(e.target.value)} className={input} />
          </div>
        ) : null}

        <div>
          <label className={label}>{t("messages.form.body")}</label>
          <textarea
            name="body"
            rows={5}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t("messages.form.bodyPlaceholder")}
            required
            className={input}
          />
        </div>

        <button
          type="submit"
          disabled={!resolved || resolved.recipients.length === 0}
          className="rounded-lg bg-gold-400 px-4 py-2 text-sm font-semibold text-ink-950 transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {(resolved?.recipients.length ?? 0) === 1
            ? t("messages.form.sendTo", { count: resolved?.recipients.length ?? 0 })
            : t("messages.form.sendTo.plural", { count: resolved?.recipients.length ?? 0 })}
        </button>
      </form>

      <Card>
        <CardHeader
          title={t("messages.recipients.title")}
          sub={
            recipients
              ? t("messages.recipients.sub", {
                  will: resolved?.recipients.length ?? 0,
                  skipped: resolved?.skipped.length ?? 0,
                })
              : t("messages.recipients.pickService")
          }
        />
        <div className="max-h-[28rem] overflow-y-auto px-5 py-4">
          {loading ? (
            <p className="text-sm text-ink-500">{t("messages.recipients.loading")}</p>
          ) : !recipients ? (
            <p className="text-sm text-ink-500">{t("messages.recipients.selectService")}</p>
          ) : !resolved ? (
            <p className="text-sm text-ink-500">{t("messages.recipients.writeBody")}</p>
          ) : (
            <div className="space-y-3">
              {resolved.recipients.map((r) => {
                const text = "body" in r.rendered ? (r.rendered as { body: string }).body : "";
                const sms = r.channel === "sms" ? formatSms(text) : null;
                return (
                  <div key={r.member_id} className="rounded-lg border border-white/8 bg-ink-950/40 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-ink-100">{r.display_name}</span>
                      <Badge tone="info">{r.channel}</Badge>
                    </div>
                    <p className="mt-0.5 font-mono text-[0.7rem] text-ink-500">{r.to_recipient}</p>
                    <p className="mt-2 whitespace-pre-wrap text-xs text-ink-300">{text}</p>
                    {sms ? (
                      <p className="mt-1 text-[0.7rem] text-ink-600">
                        {sms.segments === 1
                          ? t("messages.recipients.chars", {
                              characters: sms.characters,
                              segments: sms.segments,
                            })
                          : t("messages.recipients.chars.plural", {
                              characters: sms.characters,
                              segments: sms.segments,
                            })}
                      </p>
                    ) : null}
                    {r.missing.length > 0 ? (
                      <p className="mt-1 text-[0.7rem] text-[color:var(--color-warning)]">
                        {t("messages.recipients.missing", { fields: r.missing.join(", ") })}
                      </p>
                    ) : null}
                  </div>
                );
              })}
              {resolved.skipped.map((s) => (
                <div key={s.member_id} className="flex items-center justify-between gap-2 rounded-lg border border-dashed border-white/8 px-3 py-2">
                  <span className="text-sm text-ink-400">{s.display_name}</span>
                  <span className="text-xs text-ink-600">
                    {t("messages.recipients.skipped", {
                      reason: SKIP_KEYS.has(s.reason) ? t(`messages.skip.${s.reason}`) : s.reason,
                    })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
