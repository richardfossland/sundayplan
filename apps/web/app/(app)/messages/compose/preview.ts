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

/**
 * Fetch the resolvable recipient data for a service so the compose form can
 * preview sends client-side with the pure SDK resolver. Returns only the fields
 * the resolver needs (no full member rows).
 */
export async function loadServiceRecipients(serviceId: string): Promise<RecipientPreview> {
  const { recipients, values } = await buildRecipientValues(serviceId);
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
