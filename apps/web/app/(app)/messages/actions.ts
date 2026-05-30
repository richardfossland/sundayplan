"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentChurchId } from "@/lib/data/church";
import { buildRecipientValues } from "@/lib/data/comms";
import { schemas } from "@sundayplan/shared";
import {
  createProvider,
  resolveRecipients,
  type SendRequest,
} from "@sundayplan/sdk";

function emptyToNull(v: FormDataEntryValue | null): string | null {
  if (v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/** Create a message template in the planner's active church. */
export async function createTemplate(formData: FormData) {
  const supabase = await createClient();
  const churchId = await getCurrentChurchId();
  if (!churchId) throw new Error("No church found for your account");

  const parsed = schemas.MessageTemplateInputSchema.safeParse({
    name: formData.get("name"),
    channel: formData.get("channel") || undefined,
    purpose: formData.get("purpose") || undefined,
    language: formData.get("language") || undefined,
    subject: emptyToNull(formData.get("subject")),
    body: formData.get("body"),
    is_active: formData.get("is_active") === "on" || formData.get("is_active") === "true",
  });
  if (!parsed.success) {
    throw new Error(parsed.error.errors[0]?.message ?? "Invalid template");
  }

  const { error } = await supabase
    .from("message_template")
    .insert({ church_id: churchId, ...parsed.data });
  if (error) throw error;

  revalidatePath("/messages/templates");
  redirect("/messages/templates");
}

/** Update an existing template. */
export async function updateTemplate(id: string, formData: FormData) {
  const supabase = await createClient();

  const parsed = schemas.MessageTemplateInputSchema.partial().safeParse({
    name: formData.get("name") || undefined,
    channel: formData.get("channel") || undefined,
    purpose: formData.get("purpose") || undefined,
    language: formData.get("language") || undefined,
    subject: emptyToNull(formData.get("subject")),
    body: formData.get("body") || undefined,
    is_active: formData.get("is_active") === "on" || formData.get("is_active") === "true",
  });
  if (!parsed.success) {
    throw new Error(parsed.error.errors[0]?.message ?? "Invalid template");
  }

  const { error } = await supabase
    .from("message_template")
    .update(parsed.data)
    .eq("id", id);
  if (error) throw error;

  revalidatePath("/messages/templates");
  redirect("/messages/templates");
}

/**
 * Compose + send a message to a service's volunteers.
 *
 * The flow is the production shape, just with a stubbed transport:
 *   1. resolve recipients (per-channel, per-recipient rendering, skip reasons)
 *   2. insert the composed `message` row (audit/history)
 *   3. transmit each recipient via the channel provider (stub by default —
 *      no network, no secrets) and insert a `message_delivery` row per result
 *
 * Swapping in real Twilio/Resend/web-push is purely `createProvider`'s job;
 * this action does not change. See packages/sdk/src/channels.ts.
 */
export async function sendServiceMessage(formData: FormData) {
  const supabase = await createClient();
  const churchId = await getCurrentChurchId();
  if (!churchId) throw new Error("No church found for your account");

  const serviceId = String(formData.get("service_id") ?? "");
  const channel = String(formData.get("channel") ?? "preferred") as
    | "sms"
    | "email"
    | "push"
    | "preferred";
  const purpose = String(formData.get("purpose") ?? "custom");
  const subject = emptyToNull(formData.get("subject"));
  const body = String(formData.get("body") ?? "");
  const templateId = emptyToNull(formData.get("template_id"));

  if (!serviceId) throw new Error("Pick a service to message");
  if (body.trim() === "") throw new Error("Message body is required");

  // 1. Resolve recipients (pure engine).
  const { recipients, values } = await buildRecipientValues(serviceId);
  const resolved = resolveRecipients(body, recipients, values, { channel, subject });

  // The persisted message uses the resolved channel when forced, else 'sms'
  // as the nominal record channel (per-delivery channel is authoritative).
  const messageChannel = channel === "preferred" ? "sms" : channel;

  const { data: userData } = await supabase.auth.getUser();

  // 2. Insert the composed message.
  const { data: msg, error: msgErr } = await supabase
    .from("message")
    .insert({
      church_id: churchId,
      template_id: templateId,
      service_id: serviceId,
      channel: messageChannel,
      purpose,
      subject,
      body,
      created_by: userData.user?.id ?? null,
    })
    .select("id")
    .single();
  if (msgErr) throw msgErr;
  const messageId = msg.id as string;

  // 3. Transmit + record deliveries.
  const deliveries: Record<string, unknown>[] = [];

  for (const r of resolved.recipients) {
    const provider = createProvider(r.channel, process.env as Record<string, string | undefined>);
    const sendBody =
      "body" in r.rendered ? (r.rendered as { body: string }).body : "";
    const req: SendRequest = {
      channel: r.channel,
      to: r.to_recipient,
      subject,
      body: sendBody,
      reference: `${messageId}:${r.member_id}`,
    };
    const result = await provider.send(req);
    deliveries.push({
      message_id: messageId,
      church_id: churchId,
      member_id: r.member_id,
      channel: r.channel,
      to_recipient: r.to_recipient,
      body_hash: await hashBody(sendBody),
      status: result.outcome === "sent" ? "sent" : "failed",
      provider: result.provider,
      provider_message_id: result.provider_message_id ?? null,
      cost_cents: result.cost_cents ?? null,
      sent_at: result.outcome === "sent" ? new Date().toISOString() : null,
    });
  }

  // Record skipped recipients too, so the planner sees who didn't get it.
  for (const s of resolved.skipped) {
    deliveries.push({
      message_id: messageId,
      church_id: churchId,
      member_id: s.member_id,
      channel: messageChannel,
      to_recipient: "—",
      status: "skipped",
      skip_reason: s.reason,
    });
  }

  if (deliveries.length > 0) {
    const { error: delErr } = await supabase.from("message_delivery").insert(deliveries);
    if (delErr) throw delErr;
  }

  revalidatePath("/messages");
  redirect("/messages");
}

/** SHA-256 hex hash of a body (GDPR — we don't store delivery plaintext). */
async function hashBody(body: string): Promise<string> {
  const data = new TextEncoder().encode(body);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
