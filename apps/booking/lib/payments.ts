/**
 * Vipps PAYMENT SEAM (Phase 5) — a provider abstraction mirroring the comms
 * provider pattern (packages/sdk channels.ts). The rest of the app talks to a
 * `PaymentProvider` interface; which implementation it gets is decided purely
 * from env by `createPaymentProvider`:
 *
 *   - `RealVippsProvider` when VIPPS_CLIENT_ID + VIPPS_CLIENT_SECRET +
 *     VIPPS_SUBSCRIPTION_KEY + VIPPS_MSN (merchant serial number) are all set.
 *   - `StubVippsProvider` otherwise — the keyless fallback. It records the
 *     intent, returns a fake redirect URL + a 'stub' status, and makes NO
 *     network call. So build / test / fresh-dev need no secrets and the rental
 *     flow degrades gracefully (a "Vipps (test)" button that flips the booking
 *     to deposit_paid via the stub-safe callback).
 *
 * The PURE request-body builders + response parsers (no I/O) are unit-tested
 * with canned fixtures. The real provider's network calls are isolated behind
 * an injectable `fetch` so they too are reachable from tests without a network.
 *
 * NO SECRETS are hardcoded here. Real Vipps needs the four env vars above set as
 * Worker secrets; until then the stub keeps everything green.
 */

export type PaymentStatus = "stub" | "created" | "authorized" | "captured" | "refunded" | "failed";

export interface CreatePaymentInput {
  /** Amount in NOK (major units). Converted to minor units (øre) for Vipps. */
  amountNok: number;
  /** Our correlation reference — typically `booking:<id>:deposit`. Vipps caps at 50 chars. */
  reference: string;
  /** Where Vipps returns the payer after the flow (absolute URL). */
  returnUrl: string;
  /** Human-readable payment description shown in the Vipps app. */
  description: string;
}

export interface CreatePaymentResult {
  ok: boolean;
  provider: string;
  /** Provider order/payment id (echoes `reference` for the stub). */
  paymentId: string;
  /** URL to send the payer to (a fake landing page for the stub). */
  redirectUrl: string;
  status: PaymentStatus;
  error?: string;
}

export interface PaymentStatusResult {
  ok: boolean;
  provider: string;
  status: PaymentStatus;
  error?: string;
}

export interface RefundResult {
  ok: boolean;
  provider: string;
  status: PaymentStatus;
  error?: string;
}

export interface PaymentProvider {
  readonly name: string;
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;
  getStatus(paymentId: string): Promise<PaymentStatusResult>;
  refundPayment(paymentId: string, amountNok: number): Promise<RefundResult>;
}

export interface PaymentEnv {
  [key: string]: string | undefined;
}

/** NOK (major units) → øre (minor units), the unit Vipps ePayment expects. */
export function nokToOre(amountNok: number): number {
  return Math.round(amountNok * 100);
}

// ── Pure request-body builder + response parser (Vipps ePayment v1) ───────────

export interface VippsCreateBody {
  amount: { currency: "NOK"; value: number };
  paymentMethod: { type: "WALLET" };
  reference: string;
  returnUrl: string;
  userFlow: "WEB_REDIRECT";
  paymentDescription: string;
}

/** Build the Vipps ePayment "create payment" body. PURE — no I/O. */
export function buildVippsCreateBody(input: CreatePaymentInput): VippsCreateBody {
  return {
    amount: { currency: "NOK", value: nokToOre(input.amountNok) },
    paymentMethod: { type: "WALLET" },
    reference: input.reference.slice(0, 50),
    returnUrl: input.returnUrl,
    userFlow: "WEB_REDIRECT",
    paymentDescription: input.description.slice(0, 100),
  };
}

/** Map a Vipps ePayment state string to our PaymentStatus. PURE. */
export function parseVippsState(state: string | undefined | null): PaymentStatus {
  switch ((state ?? "").toUpperCase()) {
    case "CREATED":
      return "created";
    case "AUTHORIZED":
      return "authorized";
    case "CAPTURED":
      return "captured";
    case "REFUNDED":
      return "refunded";
    case "TERMINATED":
    case "ABORTED":
    case "EXPIRED":
    case "FAILED":
      return "failed";
    default:
      return "created";
  }
}

/**
 * Map a payment-provider status to the booking.payment_status enum value the
 * `set_payment_status` RPC expects. `isDeposit` distinguishes a deposit capture
 * (→ deposit_paid) from a full-amount capture (→ paid). PURE.
 */
export function paymentStatusToBookingStatus(
  status: PaymentStatus,
  isDeposit: boolean,
): "none" | "deposit_pending" | "deposit_paid" | "paid" | "refunded" {
  switch (status) {
    case "created":
    case "authorized":
    case "stub":
      return "deposit_pending";
    case "captured":
      return isDeposit ? "deposit_paid" : "paid";
    case "refunded":
      return "refunded";
    case "failed":
    default:
      return "none";
  }
}

// ── Stub provider (keyless fallback) ──────────────────────────────────────────

export interface StubPaymentOptions {
  /** Capture intents in-memory for assertions / a dev "outbox". */
  outbox?: CreatePaymentInput[];
  /** Force createPayment to fail — exercises the failure path in tests. */
  failAll?: boolean;
}

/**
 * Records the intent and returns a fake redirect; no network. The "redirect"
 * points back at our own callback with ?stub=1 so the local flow completes
 * end-to-end (the callback route is stub-safe and flips deposit_paid).
 */
export class StubVippsProvider implements PaymentProvider {
  readonly name = "stub";
  constructor(private readonly opts: StubPaymentOptions = {}) {}

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    this.opts.outbox?.push(input);
    if (this.opts.failAll) {
      return {
        ok: false,
        provider: this.name,
        paymentId: input.reference,
        redirectUrl: "",
        status: "failed",
        error: "stub_forced_failure",
      };
    }
    const sep = input.returnUrl.includes("?") ? "&" : "?";
    return {
      ok: true,
      provider: this.name,
      paymentId: input.reference,
      // Land straight on the return URL with a stub marker → callback completes.
      redirectUrl: `${input.returnUrl}${sep}stub=1&reference=${encodeURIComponent(input.reference)}`,
      status: "stub",
    };
  }

  async getStatus(_paymentId: string): Promise<PaymentStatusResult> {
    return { ok: true, provider: this.name, status: "stub" };
  }

  async refundPayment(_paymentId: string, _amountNok: number): Promise<RefundResult> {
    return { ok: true, provider: this.name, status: "refunded" };
  }
}

// ── Real Vipps provider (behind injectable fetch) ─────────────────────────────

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

interface VippsAccessToken {
  access_token: string;
  expires_at: number; // epoch ms
}

/**
 * Vipps ePayment adapter. Pure `fetch` (Node + Workers). Credentials from env.
 * Failures never throw — they become `ok:false` results so callers can record
 * 'none'/retry without crashing the rental flow.
 */
export class RealVippsProvider implements PaymentProvider {
  readonly name = "vipps";
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly subscriptionKey: string;
  private readonly msn: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private token: VippsAccessToken | null = null;

  constructor(env: PaymentEnv, fetchImpl: FetchLike = fetch) {
    this.clientId = env.VIPPS_CLIENT_ID ?? "";
    this.clientSecret = env.VIPPS_CLIENT_SECRET ?? "";
    this.subscriptionKey = env.VIPPS_SUBSCRIPTION_KEY ?? "";
    this.msn = env.VIPPS_MSN ?? "";
    // Test (MT) vs production base URL, selected by env (defaults to test).
    this.baseUrl =
      env.VIPPS_BASE_URL ??
      (env.VIPPS_ENV === "production"
        ? "https://api.vipps.no"
        : "https://apitest.vipps.no");
    this.fetchImpl = fetchImpl;
  }

  private commonHeaders(token: string): Record<string, string> {
    return {
      Authorization: `Bearer ${token}`,
      "Ocp-Apim-Subscription-Key": this.subscriptionKey,
      "Merchant-Serial-Number": this.msn,
      "Content-Type": "application/json",
      "Vipps-System-Name": "sundaybooking",
    };
  }

  private async accessToken(nowMs: number = Date.now()): Promise<string | null> {
    if (this.token && this.token.expires_at > nowMs + 60_000) return this.token.access_token;
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/accesstoken/get`, {
        method: "POST",
        headers: {
          client_id: this.clientId,
          client_secret: this.clientSecret,
          "Ocp-Apim-Subscription-Key": this.subscriptionKey,
        },
      });
      if (!res.ok) return null;
      const json = (await res.json().catch(() => ({}))) as {
        access_token?: string;
        expires_in?: string | number;
      };
      if (!json.access_token) return null;
      const ttl = Number(json.expires_in ?? 3600) * 1000;
      this.token = { access_token: json.access_token, expires_at: nowMs + ttl };
      return this.token.access_token;
    } catch {
      return null;
    }
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const token = await this.accessToken();
    if (!token) {
      return { ok: false, provider: this.name, paymentId: input.reference, redirectUrl: "", status: "failed", error: "vipps_auth_failed" };
    }
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/epayment/v1/payments`, {
        method: "POST",
        headers: { ...this.commonHeaders(token), "Idempotency-Key": input.reference.slice(0, 50) },
        body: JSON.stringify(buildVippsCreateBody(input)),
      });
      const json = (await res.json().catch(() => ({}))) as { reference?: string; redirectUrl?: string };
      if (!res.ok || !json.redirectUrl) {
        return { ok: false, provider: this.name, paymentId: input.reference, redirectUrl: "", status: "failed", error: `vipps_create_${res.status}` };
      }
      return { ok: true, provider: this.name, paymentId: json.reference ?? input.reference, redirectUrl: json.redirectUrl, status: "created" };
    } catch (e) {
      return { ok: false, provider: this.name, paymentId: input.reference, redirectUrl: "", status: "failed", error: e instanceof Error ? e.message : String(e) };
    }
  }

  async getStatus(paymentId: string): Promise<PaymentStatusResult> {
    const token = await this.accessToken();
    if (!token) return { ok: false, provider: this.name, status: "failed", error: "vipps_auth_failed" };
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/epayment/v1/payments/${encodeURIComponent(paymentId)}`, {
        method: "GET",
        headers: this.commonHeaders(token),
      });
      const json = (await res.json().catch(() => ({}))) as { state?: string };
      if (!res.ok) return { ok: false, provider: this.name, status: "failed", error: `vipps_status_${res.status}` };
      return { ok: true, provider: this.name, status: parseVippsState(json.state) };
    } catch (e) {
      return { ok: false, provider: this.name, status: "failed", error: e instanceof Error ? e.message : String(e) };
    }
  }

  async refundPayment(paymentId: string, amountNok: number): Promise<RefundResult> {
    const token = await this.accessToken();
    if (!token) return { ok: false, provider: this.name, status: "failed", error: "vipps_auth_failed" };
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/epayment/v1/payments/${encodeURIComponent(paymentId)}/refund`, {
        method: "POST",
        headers: { ...this.commonHeaders(token), "Idempotency-Key": `refund:${paymentId}`.slice(0, 50) },
        body: JSON.stringify({ modificationAmount: { currency: "NOK", value: nokToOre(amountNok) } }),
      });
      if (!res.ok) return { ok: false, provider: this.name, status: "failed", error: `vipps_refund_${res.status}` };
      return { ok: true, provider: this.name, status: "refunded" };
    } catch (e) {
      return { ok: false, provider: this.name, status: "failed", error: e instanceof Error ? e.message : String(e) };
    }
  }
}

// ── Factory + config probe ────────────────────────────────────────────────────

/** True when ALL real Vipps merchant credentials are present. */
export function paymentsConfigured(env: PaymentEnv = {}): boolean {
  return Boolean(
    env.VIPPS_CLIENT_ID &&
      env.VIPPS_CLIENT_SECRET &&
      env.VIPPS_SUBSCRIPTION_KEY &&
      env.VIPPS_MSN,
  );
}

/**
 * Pick the payment provider from env. Without merchant creds the stub is
 * returned, so callers never know which is live: paste the Worker secrets and
 * the same code path starts charging real cards.
 */
export function createPaymentProvider(
  env: PaymentEnv = {},
  stubOptions: StubPaymentOptions = {},
): PaymentProvider {
  if (paymentsConfigured(env)) return new RealVippsProvider(env);
  return new StubVippsProvider(stubOptions);
}
