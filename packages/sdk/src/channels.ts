/**
 * Channel / provider abstraction for the comms layer (Phase 6).
 *
 * The pure engine in `comms.ts` decides *what* to send and to *whom*; a
 * `Provider` is responsible for the actual transmission of one channel. The
 * default, always-available provider is `StubProvider`, which records the send
 * and returns success WITHOUT any network call — so the build, the tests, and a
 * fresh local dev install need no secrets and hit no external API.
 *
 * Real providers live in `./providers/` and are selected by `createProvider`
 * purely from env vars: Twilio (SMS) when `TWILIO_ACCOUNT_SID`+`TWILIO_AUTH_TOKEN`
 * are present, Resend (email) on `RESEND_API_KEY`, SMTP (email, Node-only
 * deployments) on `SMTP_URL`. Web push remains a seam. Without credentials the
 * factory falls back to the stub, so builds, tests, and fresh dev installs need
 * no secrets and hit no external API — and going live is pasting env vars, not
 * changing callers.
 */

import type { MessageChannel } from "@sundayplan/shared";

import { ResendEmailProvider } from "./providers/resend";
import { SmtpEmailProvider } from "./providers/smtp";
import { TwilioSmsProvider } from "./providers/twilio";

export interface SendRequest {
  channel: MessageChannel;
  /** Normalized destination — phone number, email, or `push:<member_id>`. */
  to: string;
  /** Subject (email) / title (push); ignored by SMS. */
  subject?: string | null;
  body: string;
  /** Opaque correlation id (our delivery row id) for provider callbacks. */
  reference?: string;
}

export type SendOutcome = "sent" | "failed";

export interface SendResult {
  outcome: SendOutcome;
  /** The provider that handled the send (e.g. "stub", "twilio"). */
  provider: string;
  /** Provider-side id, when the provider returns one. */
  provider_message_id?: string;
  /** Estimated cost in cents, when known (stub estimates SMS segments). */
  cost_cents?: number;
  /** Failure detail, when `outcome === "failed"`. */
  error?: string;
}

/** A provider transmits messages for ONE channel. */
export interface Provider {
  readonly name: string;
  readonly channel: MessageChannel;
  send(req: SendRequest): Promise<SendResult>;
}

// ── Default stub / console provider ───────────────────────────────────────────

export interface StubProviderOptions {
  /** Log each send to the console (default: false — keeps tests quiet). */
  log?: boolean;
  /** Capture sends in-memory for assertions / a dev "outbox". */
  outbox?: SendRequest[];
  /** Force every send to fail — for exercising the failure path in tests. */
  failAll?: boolean;
  /** Flat per-message cost estimate in cents (default 0). */
  costCents?: number;
}

/**
 * Records the send and returns success. No network. Safe everywhere. This is
 * the default for every channel until a real provider is configured.
 */
export class StubProvider implements Provider {
  readonly name = "stub";
  constructor(
    readonly channel: MessageChannel,
    private readonly opts: StubProviderOptions = {},
  ) {}

  async send(req: SendRequest): Promise<SendResult> {
    this.opts.outbox?.push(req);
    if (this.opts.log) {
      // eslint-disable-next-line no-console
      console.info(`[comms:stub:${req.channel}] → ${req.to}: ${req.body.slice(0, 80)}`);
    }
    if (this.opts.failAll) {
      return { outcome: "failed", provider: this.name, error: "stub_forced_failure" };
    }
    return {
      outcome: "sent",
      provider: this.name,
      provider_message_id: `stub-${req.reference ?? cryptoRandomId()}`,
      cost_cents: this.opts.costCents ?? 0,
    };
  }
}

function cryptoRandomId(): string {
  // Web Crypto is present in Node 18+ and Deno; fall back to Math.random.
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  return g.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
}

// ── Provider factory + real-provider seams ────────────────────────────────────

export interface ProviderEnv {
  /** e.g. process.env — anything with string lookups. */
  [key: string]: string | undefined;
}

/**
 * Pick the provider for a channel based on env. Keeping the branch here
 * (rather than at call sites) means the rest of the app never knows which
 * provider is live: paste credentials into the deployment env and the same
 * code path starts transmitting for real.
 */
export function createProvider(
  channel: MessageChannel,
  env: ProviderEnv = {},
  stubOptions: StubProviderOptions = {},
): Provider {
  if (hasRealProvider(channel, env)) {
    switch (channel) {
      case "sms":
        return new TwilioSmsProvider(env);
      case "email":
        // Resend wins when both are configured: it is the Workers-safe path,
        // while SMTP needs raw TCP (Node-only deployments — see ./providers/smtp).
        return env.RESEND_API_KEY ? new ResendEmailProvider(env) : new SmtpEmailProvider(env);
      case "push":
        // SEAM: return new WebPushProvider(env); — deliberately unimplemented,
        // SMS + email satisfy the volunteer-communication promise.
        break;
    }
  }
  return new StubProvider(channel, stubOptions);
}

/** True if a real (non-stub) provider is configured for the channel. */
export function hasRealProvider(channel: MessageChannel, env: ProviderEnv = {}): boolean {
  switch (channel) {
    case "sms":
      return !!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN);
    case "email":
      return !!(env.RESEND_API_KEY || env.SMTP_URL);
    case "push":
      return !!env.WEB_PUSH_VAPID_PRIVATE_KEY;
  }
}
