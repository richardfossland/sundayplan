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
          <label className={label}>Template name</label>
          <input name="name" required defaultValue={template?.name ?? ""} placeholder="e.g. Sunday invite" className={input} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label}>Channel</label>
            <select
              name="channel"
              value={channel}
              onChange={(e) => setChannel(e.target.value as MessageTemplate["channel"])}
              className={input}
            >
              <option value="sms">SMS</option>
              <option value="email">Email</option>
              <option value="push">Push</option>
            </select>
          </div>
          <div>
            <label className={label}>Purpose</label>
            <select name="purpose" defaultValue={template?.purpose ?? "custom"} className={input}>
              <option value="invite">Invite</option>
              <option value="reminder">Reminder</option>
              <option value="final_reminder">Final reminder</option>
              <option value="confirmation">Confirmation</option>
              <option value="cancellation">Cancellation</option>
              <option value="custom">Custom</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label}>Language</label>
            <select name="language" defaultValue={template?.language ?? "no"} className={input}>
              <option value="no">Norwegian</option>
              <option value="en">English</option>
              <option value="sv">Swedish</option>
              <option value="da">Danish</option>
              <option value="de">German</option>
              <option value="fr">French</option>
              <option value="pl">Polish</option>
            </select>
          </div>
          <div>
            <label className={label}>Status</label>
            <select name="is_active" defaultValue={template?.is_active === false ? "false" : "true"} className={input}>
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </select>
          </div>
        </div>

        {channel !== "sms" ? (
          <div>
            <label className={label}>{channel === "push" ? "Title" : "Subject"}</label>
            <input
              name="subject"
              value={subject ?? ""}
              onChange={(e) => setSubject(e.target.value)}
              placeholder={channel === "push" ? "Notification title" : "Email subject"}
              className={input}
            />
          </div>
        ) : null}

        <div>
          <label className={label}>Body</label>
          <textarea
            name="body"
            rows={6}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Hi {{volunteer_name}}, you're on {{role_name}} for {{service_title}} on {{service_date}}."
            required
            className={input}
          />
          <p className="mt-1 text-xs text-ink-600">Use {`{{variables}}`} — see the list on the right.</p>
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
          <CardHeader title={`Live preview · ${channel.toUpperCase()}`} sub="Rendered with sample values" />
          <div className="px-5 py-4">
            {channel !== "sms" && subject ? (
              <div className="mb-2 font-medium text-ink-100">{renderTemplate(subject, SAMPLE).text}</div>
            ) : null}
            <pre className="whitespace-pre-wrap break-words font-sans text-sm text-ink-200">{render.text || "…"}</pre>
            {sms ? (
              <div className="mt-3 text-xs text-ink-500">
                {sms.characters} chars · {sms.encoding} · {sms.segments} segment{sms.segments === 1 ? "" : "s"}
              </div>
            ) : null}
          </div>
        </Card>

        <Card>
          <CardHeader title="Variables" sub="Highlighted ones are used in the body" />
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
                Unknown: {vars.unknown.map((u) => `{{${u}}}`).join(", ")}
              </p>
            ) : null}
          </div>
        </Card>
      </div>
    </div>
  );
}
