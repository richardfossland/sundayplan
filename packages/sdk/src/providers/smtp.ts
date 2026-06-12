/**
 * SMTP email adapter — the no-vendor fallback for self-hosted / Node deploys.
 *
 * IMPORTANT RUNTIME CAVEAT: raw SMTP needs TCP sockets, which Cloudflare
 * Workers (where plan.sundaysuite.app runs) do not provide to nodemailer. This
 * adapter is therefore only selected when `SMTP_URL` is set AND
 * `RESEND_API_KEY` is not — i.e. a deliberate choice on a Node deployment. To
 * keep the SDK bundleable for Workers, nodemailer is loaded via a computed
 * dynamic import at send time (never statically), and tests inject a fake
 * transport instead.
 *
 * Env:
 *   SMTP_URL   — e.g. `smtp://user:pass@mail.example.com:587` (required)
 *   EMAIL_FROM — sender (required)
 */

import type { Provider, ProviderEnv, SendRequest, SendResult } from "../channels";

/** The slice of a nodemailer transport we use — injectable for tests. */
export interface MailTransport {
  sendMail(msg: {
    from: string;
    to: string;
    subject: string;
    text: string;
  }): Promise<{ messageId?: string }>;
}

export class SmtpEmailProvider implements Provider {
  readonly name = "smtp";
  readonly channel = "email" as const;

  private readonly smtpUrl: string;
  private readonly from?: string;
  private transport?: MailTransport;

  constructor(env: ProviderEnv, transport?: MailTransport) {
    this.smtpUrl = env.SMTP_URL ?? "";
    this.from = env.EMAIL_FROM || undefined;
    this.transport = transport;
  }

  async send(req: SendRequest): Promise<SendResult> {
    if (!this.smtpUrl) return this.fail("smtp_not_configured: missing SMTP_URL");
    if (!this.from) return this.fail("smtp_not_configured: set EMAIL_FROM");
    if (!req.to.includes("@")) return this.fail(`invalid_email: "${req.to}"`);

    try {
      const transport = await this.resolveTransport();
      const info = await transport.sendMail({
        from: this.from,
        to: req.to,
        subject: req.subject ?? "",
        text: req.body,
      });
      return { outcome: "sent", provider: this.name, provider_message_id: info.messageId };
    } catch (e) {
      return this.fail(`smtp_error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private async resolveTransport(): Promise<MailTransport> {
    if (this.transport) return this.transport;
    // Computed specifier so bundlers (OpenNext/esbuild for Workers) leave the
    // import to runtime instead of pulling nodemailer into the Worker bundle.
    const specifier = "nodemailer";
    const nodemailer = (await import(/* @vite-ignore */ specifier)) as {
      createTransport(url: string): MailTransport;
    };
    this.transport = nodemailer.createTransport(this.smtpUrl);
    return this.transport;
  }

  private fail(error: string): SendResult {
    return { outcome: "failed", provider: this.name, error };
  }
}
