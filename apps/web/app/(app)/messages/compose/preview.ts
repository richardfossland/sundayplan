"use server";

import { buildRecipientValues } from "@/lib/data/comms";
import type { PerRecipientValues } from "@sundayplan/sdk";

export interface RecipientPreview {
  members: {
    member_id: string;
    display_name: string;
    phone_e164: string | null;
    email: string | null;
    preferred_channel: "sms" | "email" | "push";
  }[];
  values: PerRecipientValues;
}

/** Placeholder shown in the preview where each recipient's real link will go. */
const LINK_PLACEHOLDER = "[accept/decline link]";

/**
 * Fetch the resolvable recipient data for a service so the compose form can
 * preview sends client-side with the pure SDK resolver. Returns only the fields
 * the resolver needs (no full member rows).
 *
 * Preview does NOT mint magic links (no token churn / DB writes on every
 * keystroke) — it substitutes a placeholder so the planner still sees where the
 * accept/decline links land. The real per-recipient links are minted server-side
 * when the message is actually sent.
 */
export async function loadServiceRecipients(serviceId: string): Promise<RecipientPreview> {
  const { recipients, values } = await buildRecipientValues(serviceId, { withLinks: false });
  for (const r of recipients) {
    const v = values[r.member_id] ?? {};
    v.accept_link = LINK_PLACEHOLDER;
    v.decline_link = LINK_PLACEHOLDER;
    values[r.member_id] = v;
  }
  return {
    members: recipients.map((r) => ({
      member_id: r.member_id,
      display_name: r.display_name,
      phone_e164: r.phone_e164,
      email: r.email,
      preferred_channel: r.preferred_channel,
    })),
    values,
  };
}
