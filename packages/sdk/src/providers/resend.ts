/**
 * Resend email adapter — primary email provider (pure `fetch`, Workers-safe).
 *
 * Env:
 *   RESEND_API_KEY — credential (required)
 *   EMAIL_FROM     — sender, e.g. `SundayPlan <plan@mail.sundaysuite.app>`
 *                    (required: Resend rejects sends without a verified from)
 *   EMAIL_REPLY_TO — optional reply-to
 *
 * Like every adapter, failures become `failed` SendResults — never throws.
 */

import type { Provider, ProviderEnv, SendRequest, SendResult } from "../channels";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class ResendEmailProvider implements Provider {
  readonly name = "resend";
  readonly channel = "email" as const;

  private readonly apiKey: string;
  private readonly from?: string;
  private readonly replyTo?: string;
  private readonly fetchImpl: FetchLike;

  constructor(env: ProviderEnv, fetchImpl: FetchLike = fetch) {
    this.apiKey = env.RESEND_API_KEY ?? "";
    this.from = env.EMAIL_FROM || undefined;
    this.replyTo = env.EMAIL_REPLY_TO || undefined;
    this.fetchImpl = fetchImpl;
  }

  async send(req: SendRequest): Promise<SendResult> {
    if (!this.apiKey) {
      return this.fail("resend_not_configured: missing RESEND_API_KEY");
    }
    if (!this.from) {
      return this.fail("resend_not_configured: set EMAIL_FROM to a verified sender");
    }
    if (!req.to.includes("@")) {
      return this.fail(`invalid_email: "${req.to}"`);
    }

    let res: Response;
    try {
      res = await this.fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: this.from,
          to: [req.to],
          subject: req.subject ?? "",
          text: req.body,
          ...(this.replyTo ? { reply_to: this.replyTo } : {}),
          ...(req.reference ? { headers: { "X-Sunday-Reference": req.reference } } : {}),
        }),
      });
    } catch (e) {
      return this.fail(`resend_network_error: ${e instanceof Error ? e.message : String(e)}`);
    }

    const payload = (await res.json().catch(() => ({}))) as {
      id?: string;
      message?: string;
      name?: string;
    };

    if (!res.ok) {
      return this.fail(`resend_error_${res.status}: ${payload.message ?? payload.name ?? res.statusText}`);
    }

    return { outcome: "sent", provider: this.name, provider_message_id: payload.id };
  }

  private fail(error: string): SendResult {
    return { outcome: "failed", provider: this.name, error };
  }
}
