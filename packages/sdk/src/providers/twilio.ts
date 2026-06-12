/**
 * Twilio SMS adapter — the first real provider behind `createProvider`.
 *
 * Pure `fetch` against Twilio's REST API (no SDK dependency), so it runs
 * unchanged in Node and Cloudflare Workers. Configured entirely from env:
 *
 *   TWILIO_ACCOUNT_SID  + TWILIO_AUTH_TOKEN   — credentials (required)
 *   TWILIO_MESSAGING_SERVICE_SID | TWILIO_FROM — sender (one required)
 *   SMS_DEFAULT_COUNTRY                        — for bare national numbers (default NO)
 *   SMS_COST_CENTS_PER_SEGMENT                 — optional cost estimate input
 *
 * Failures never throw: every problem (invalid number, missing sender, HTTP
 * error) becomes a `failed` SendResult so the comms engine records it on the
 * delivery row like any other outcome.
 */

import type { Provider, ProviderEnv, SendRequest, SendResult } from "../channels";
import { estimateSmsCostCents, smsSegments, toE164 } from "./phone";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class TwilioSmsProvider implements Provider {
  readonly name = "twilio";
  readonly channel = "sms" as const;

  private readonly accountSid: string;
  private readonly authToken: string;
  private readonly messagingServiceSid?: string;
  private readonly from?: string;
  private readonly defaultCountry: string;
  private readonly costCentsPerSegment?: number;
  private readonly fetchImpl: FetchLike;

  constructor(env: ProviderEnv, fetchImpl: FetchLike = fetch) {
    this.accountSid = env.TWILIO_ACCOUNT_SID ?? "";
    this.authToken = env.TWILIO_AUTH_TOKEN ?? "";
    this.messagingServiceSid = env.TWILIO_MESSAGING_SERVICE_SID || undefined;
    this.from = env.TWILIO_FROM || undefined;
    this.defaultCountry = env.SMS_DEFAULT_COUNTRY || "NO";
    const cost = env.SMS_COST_CENTS_PER_SEGMENT;
    this.costCentsPerSegment = cost ? Number(cost) : undefined;
    this.fetchImpl = fetchImpl;
  }

  async send(req: SendRequest): Promise<SendResult> {
    if (!this.accountSid || !this.authToken) {
      return this.fail("twilio_not_configured: missing TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN");
    }
    if (!this.messagingServiceSid && !this.from) {
      return this.fail(
        "twilio_not_configured: set TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM",
      );
    }

    const to = toE164(req.to, this.defaultCountry);
    if (!to) {
      return this.fail(`invalid_phone: "${req.to}" is not a valid number`);
    }

    const body = new URLSearchParams({ To: to, Body: req.body });
    if (this.messagingServiceSid) body.set("MessagingServiceSid", this.messagingServiceSid);
    else if (this.from) body.set("From", this.from);

    let res: Response;
    try {
      res = await this.fetchImpl(
        `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${base64(`${this.accountSid}:${this.authToken}`)}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: body.toString(),
        },
      );
    } catch (e) {
      return this.fail(`twilio_network_error: ${e instanceof Error ? e.message : String(e)}`);
    }

    const payload = (await res.json().catch(() => ({}))) as {
      sid?: string;
      status?: string;
      message?: string;
      code?: number;
    };

    if (!res.ok) {
      return this.fail(
        `twilio_error_${payload.code ?? res.status}: ${payload.message ?? res.statusText}`,
      );
    }

    return {
      outcome: "sent",
      provider: this.name,
      provider_message_id: payload.sid,
      cost_cents: estimateSmsCostCents(req.body, this.costCentsPerSegment),
    };
  }

  /** Segment count exposed for quota/cost previews in the compose UI. */
  segments(body: string): number {
    return smsSegments(body);
  }

  private fail(error: string): SendResult {
    return { outcome: "failed", provider: this.name, error };
  }
}

/** btoa that works in both Node (Buffer) and Workers/browsers (btoa). */
function base64(s: string): string {
  const g = globalThis as { btoa?: (s: string) => string; Buffer?: typeof Buffer };
  if (g.btoa) return g.btoa(s);
  return g.Buffer ? g.Buffer.from(s, "utf8").toString("base64") : s;
}
