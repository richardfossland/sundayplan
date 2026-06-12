"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentChurchId } from "@/lib/data/church";
import { buildRecipientValues } from "@/lib/data/comms";
import { schemas } from "@sundayplan/shared";
import {
  checkSmsQuota,
  createProvider,
  resolveRecipients,
  smsSegments,
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

  // Quota gate: SMS is the metered resource (email is unmetered). Refuse the
  // whole send up front rather than transmitting half a roster — a partial
  // rota announcement is worse than a clear "quota reached" error.
  const plannedSmsSegments = resolved.recipients
    .filter((r) => r.channel === "sms")
    .reduce(
      (sum, r) => sum + smsSegments("body" in r.rendered ? (r.rendered as { body: string }).body : ""),
      0,
    );

  let quotaState: { used: number; usedAtReset: string } | null = null;
  if (plannedSmsSegments > 0) {
    const [{ data: church }, { data: settings }] = await Promise.all([
      supabase.from("church").select("plan_tier").eq("id", churchId).single(),
      supabase
        .from("church_settings")
        .select("sms_quota_used, sms_quota_used_at_reset")
        .eq("church_id", churchId)
        .single(),
    ]);
    quotaState = {
      used: settings?.sms_quota_used ?? 0,
      usedAtReset: settings?.sms_quota_used_at_reset ?? new Date(0).toISOString(),
    };
    const decision = checkSmsQuota(
      { tier: church?.plan_tier, used: quotaState.used, usedAtReset: quotaState.usedAtReset },
      plannedSmsSegments,
    );
    if (!decision.allowed) {
      throw new Error(decision.reason ?? "SMS quota reached for this month");
    }
  }

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
  let sentSmsSegments = 0;

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
    if (r.channel === "sms" && result.outcome === "sent") {
      sentSmsSegments += smsSegments(sendBody);
    }
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

  // Persist quota usage for the segments that actually transmitted. The
  // pre-check used the planned total; the counter only records reality.
  if (quotaState && sentSmsSegments > 0) {
    const rollover = checkSmsQuota(
      { tier: null, used: quotaState.used, usedAtReset: quotaState.usedAtReset },
      0,
    );
    const baseUsed = rollover.shouldReset ? 0 : quotaState.used;
    const { error: quotaErr } = await supabase
      .from("church_settings")
      .update({
        sms_quota_used: baseUsed + sentSmsSegments,
        ...(rollover.shouldReset ? { sms_quota_used_at_reset: new Date().toISOString() } : {}),
      })
      .eq("church_id", churchId);
    if (quotaErr) throw quotaErr;
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
