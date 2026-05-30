/**
 * Channel / provider abstraction for the comms layer (Phase 6).
 *
 * The pure engine in `comms.ts` decides *what* to send and to *whom*; a
 * `Provider` is responsible for the actual transmission of one channel. The
 * default, always-available provider is `StubProvider`, which records the send
 * and returns success WITHOUT any network call — so the build, the tests, and a
 * fresh local dev install need no secrets and hit no external API.
 *
 * Real providers (Twilio for SMS, Resend/SMTP for email, web push) are
 * intentionally NOT implemented here. They live behind the `createProvider`
 * factory and are gated by env vars. Until those are wired up + credentialed,
 * the factory falls back to the stub. This is the clean seam: implementing a
 * real provider means satisfying the `Provider` interface and registering it in
 * `createProvider` — no caller changes.
 *
 * See `docs/DOMAIN.md` (Phase 6 section) for the deferral rationale.
 */

import type { MessageChannel } from "@sundayplan/shared";

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
 * Pick the provider for a channel based on env. Today this always returns the
 * stub; the commented seams below are exactly where a real provider slots in
 * once its adapter is implemented and its env vars are present. Keeping the
 * branch here (rather than at call sites) means the rest of the app never knows
 * which provider is live.
 */
export function createProvider(
  channel: MessageChannel,
  env: ProviderEnv = {},
  stubOptions: StubProviderOptions = {},
): Provider {
  // When real credentials are present, a real adapter would be returned here.
  // The adapters are unimplemented (Phase 6+), so we deliberately fall through
  // to the stub even if `hasRealProvider` is true — keeping the build network-
  // and secret-free. Implementing an adapter = add its branch below.
  if (hasRealProvider(channel, env)) {
    switch (channel) {
      case "sms":
        // SEAM: return new TwilioSmsProvider(env);
        break;
      case "email":
        // SEAM: return env.RESEND_API_KEY
        //   ? new ResendEmailProvider(env) : new SmtpEmailProvider(env);
        break;
      case "push":
        // SEAM: return new WebPushProvider(env);
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
