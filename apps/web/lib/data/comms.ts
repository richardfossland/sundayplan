import { createClient } from "@/lib/supabase/server";
import { mintResponseLinks, type MintedResponseLink } from "@/lib/data/magic-link";
import {
  resolveRecipients,
  type PerRecipientValues,
  type ResolvableMember,
  type ResolveResult,
} from "@sundayplan/sdk";
import type {
  MessageChannel,
  MessageDelivery,
  MessagePurpose,
  MessageTemplate,
} from "@sundayplan/shared";

export interface TemplateListItem {
  id: string;
  name: string;
  channel: MessageChannel;
  purpose: MessagePurpose;
  language: string;
  subject: string | null;
  body: string;
  is_active: boolean;
}

/** Templates in the planner's church. RLS scopes the rows. */
export async function listTemplates(): Promise<TemplateListItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("message_template")
    .select("id, name, channel, purpose, language, subject, body, is_active")
    .order("name");
  if (error) throw error;
  return (data ?? []).map((t: Record<string, unknown>) => ({
    id: t.id as string,
    name: t.name as string,
    channel: t.channel as MessageChannel,
    purpose: t.purpose as MessagePurpose,
    language: t.language as string,
    subject: (t.subject as string | null) ?? null,
    body: t.body as string,
    is_active: (t.is_active as boolean) ?? true,
  }));
}

export async function getTemplate(id: string): Promise<MessageTemplate | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("message_template")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as MessageTemplate | null) ?? null;
}

export interface ComposeService {
  id: string;
  name: string;
  starts_at_utc: string;
}

/** Upcoming services a planner can target with a message. */
export async function listComposeServices(): Promise<ComposeService[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("service")
    .select("id, name, starts_at_utc")
    .order("starts_at_utc", { ascending: true })
    .limit(20);
  if (error) throw error;
  return (data ?? []).map((s: Record<string, unknown>) => ({
    id: s.id as string,
    name: s.name as string,
    starts_at_utc: s.starts_at_utc as string,
  }));
}

export interface ServiceRecipient extends ResolvableMember {
  role_name: string;
  /** The assignment this volunteer is responding to (for the magic link). */
  assignment_id: string;
  church_id: string;
}

/**
 * The people assigned to a service, with the contact info + role the message
 * engine needs. One entry per (member, role) so a member assigned to two roles
 * is addressed once per role for the preview, but resolution de-dupes by member
 * downstream when sending. We collapse to one entry per member here (their first
 * role) so each volunteer gets a single message.
 */
export async function getServiceRecipients(serviceId: string): Promise<{
  service: ComposeService | null;
  recipients: ServiceRecipient[];
}> {
  const supabase = await createClient();

  const { data: svc, error: svcErr } = await supabase
    .from("service")
    .select("id, name, starts_at_utc")
    .eq("id", serviceId)
    .maybeSingle();
  if (svcErr) throw svcErr;

  const { data: assignments, error: aErr } = await supabase
    .from("assignment")
    .select(
      "id, church_id, member_id, role:role_id(name), member:member_id(id, display_name, phone_e164, email, preferred_channel)",
    )
    .eq("service_id", serviceId)
    .neq("status", "removed");
  if (aErr) throw aErr;

  const byMember = new Map<string, ServiceRecipient>();
  for (const a of (assignments ?? []) as Record<string, unknown>[]) {
    const m = a.member as Record<string, unknown> | null;
    if (!m) continue;
    const id = m.id as string;
    if (byMember.has(id)) continue; // one message per volunteer
    byMember.set(id, {
      member_id: id,
      display_name: m.display_name as string,
      phone_e164: (m.phone_e164 as string | null) ?? null,
      email: (m.email as string | null) ?? null,
      preferred_channel: (m.preferred_channel as ServiceRecipient["preferred_channel"]) ?? "sms",
      role_name: ((a.role as Record<string, unknown>)?.name as string) ?? "—",
      assignment_id: a.id as string,
      church_id: a.church_id as string,
    });
  }

  return {
    service: (svc as ComposeService | null) ?? null,
    recipients: [...byMember.values()],
  };
}

/**
 * Build the per-recipient template values for a service send. Phase 7: this now
 * mints one signed magic link per recipient (reusing `@sundayplan/auth`) and
 * fills the `accept_link` / `decline_link` template variables, so a (stubbed)
 * send carries working, personalized no-account RSVP links.
 *
 * `withLinks` (default true) can be turned off for a pure render preview that
 * doesn't need to mint tokens or touch the DB.
 */
export async function buildRecipientValues(
  serviceId: string,
  opts: { withLinks?: boolean } = {},
): Promise<{ recipients: ServiceRecipient[]; values: PerRecipientValues; service: ComposeService | null; churchName: string }> {
  const supabase = await createClient();
  const { service, recipients } = await getServiceRecipients(serviceId);

  const { data: church } = await supabase.from("church").select("name").maybeSingle();
  const churchName = (church?.name as string | undefined) ?? "your church";

  const { data: settings } = await supabase
    .from("church_settings")
    .select("single_use_response_links")
    .maybeSingle();
  const singleUse = Boolean(settings?.single_use_response_links);

  const date = service ? new Date(service.starts_at_utc) : null;
  const serviceDate = date ? date.toISOString().slice(0, 10) : "";
  const serviceTime = date ? date.toISOString().slice(11, 16) : "";

  // Mint per-recipient accept/decline links (one signed token each).
  let links: Record<string, MintedResponseLink> = {};
  if (opts.withLinks !== false && recipients.length > 0) {
    const targets = recipients.map((r) => ({
      member_id: r.member_id,
      church_id: r.church_id,
      assignment_id: r.assignment_id,
    }));
    ({ links } = await mintResponseLinks(targets, { singleUse }));
  }

  const values: PerRecipientValues = {};
  for (const r of recipients) {
    const link = links[r.member_id];
    values[r.member_id] = {
      volunteer_name: r.display_name,
      role_name: r.role_name,
      service_title: service?.name ?? "",
      service_date: serviceDate,
      service_time: serviceTime,
      church_name: churchName,
      ...(link
        ? { accept_link: link.accept_link, decline_link: link.decline_link }
        : {}),
    };
  }

  return { recipients, values, service, churchName };
}

/** Resolve + preview a service send without persisting anything. */
export async function previewServiceSend(
  serviceId: string,
  body: string,
  channel: MessageChannel | "preferred",
  subject: string | null,
): Promise<{ service: ComposeService | null; result: ResolveResult }> {
  // Preview doesn't mint tokens (no DB write / no token churn) — links show as
  // placeholders. The real send (sendServiceMessage) mints them.
  const { recipients, values, service } = await buildRecipientValues(serviceId, {
    withLinks: false,
  });
  const result = resolveRecipients(body, recipients, values, { channel, subject });
  return { service, result };
}

export interface DeliveryLogItem {
  id: string;
  status: MessageDelivery["status"];
  channel: MessageChannel;
  to_recipient: string;
  skip_reason: string | null;
  provider: string | null;
  member_name: string | null;
  message_purpose: MessagePurpose;
  message_subject: string | null;
  service_name: string | null;
  created_at: string;
}

/** Recent deliveries for the church's message history view. */
export async function listDeliveries(limit = 100): Promise<DeliveryLogItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("message_delivery")
    .select(
      "id, status, channel, to_recipient, skip_reason, provider, created_at, member:member_id(display_name), message:message_id(purpose, subject, service:service_id(name))",
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;

  return (data ?? []).map((d: Record<string, unknown>) => {
    const msg = d.message as Record<string, unknown> | null;
    return {
      id: d.id as string,
      status: d.status as MessageDelivery["status"],
      channel: d.channel as MessageChannel,
      to_recipient: d.to_recipient as string,
      skip_reason: (d.skip_reason as string | null) ?? null,
      provider: (d.provider as string | null) ?? null,
      member_name: ((d.member as Record<string, unknown>)?.display_name as string | undefined) ?? null,
      message_purpose: ((msg?.purpose as MessagePurpose) ?? "custom"),
      message_subject: (msg?.subject as string | null) ?? null,
      service_name: ((msg?.service as Record<string, unknown>)?.name as string | undefined) ?? null,
      created_at: d.created_at as string,
    };
  });
}
