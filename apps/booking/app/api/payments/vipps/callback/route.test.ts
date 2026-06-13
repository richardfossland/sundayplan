/**
 * Adversarial tests for the Vipps callback — the body is UNTRUSTED, so a forged
 * "CAPTURED" must never flip payment_status without a provider-confirmed status.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock the data layer so no real DB / service-role client is touched. ───────
const setPaymentStatus = vi.fn((..._a: unknown[]) => Promise.resolve({ ok: true }));
const getBookingById = vi.fn((..._a: unknown[]) => Promise.resolve<unknown>(null));
vi.mock("@/lib/data/booking", () => ({
  getBookingById: (...a: unknown[]) => getBookingById(...a),
  getRentalAgreement: vi.fn(async () => null),
  setPaymentStatus: (...a: unknown[]) => setPaymentStatus(...a),
}));

// ── Mock the payment provider's getStatus so we control confirmation. ─────────
const getStatus = vi.fn();
vi.mock("@/lib/payments", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    createPaymentProvider: () => ({
      name: "vipps",
      getStatus: (...a: unknown[]) => getStatus(...a),
    }),
  };
});

const REAL_ENV = {
  VIPPS_CLIENT_ID: "id",
  VIPPS_CLIENT_SECRET: "secret",
  VIPPS_SUBSCRIPTION_KEY: "sub",
  VIPPS_MSN: "123456",
};

const BOOKING_ID = "11111111-1111-1111-1111-111111111111";
const ref = `booking:${BOOKING_ID}:deposit`;

async function postCallback(body: unknown): Promise<Response> {
  const { POST } = await import("./route");
  const req = new Request("https://booking.test/api/payments/vipps/callback", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return POST(req as never);
}

function setEnv(env: Record<string, string | undefined>) {
  for (const k of ["VIPPS_CLIENT_ID", "VIPPS_CLIENT_SECRET", "VIPPS_SUBSCRIPTION_KEY", "VIPPS_MSN"]) {
    delete process.env[k];
  }
  Object.assign(process.env, env);
}

describe("vipps callback — forgery hardening", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getBookingById.mockResolvedValue({
      id: BOOKING_ID,
      church_id: "22222222-2222-2222-2222-222222222222",
      payment_reference: "vipps-order-1",
      payment_status: "deposit_pending",
    });
  });
  afterEach(() => setEnv({}));

  it("rejects a malformed reference", async () => {
    setEnv(REAL_ENV);
    const res = await postCallback({ reference: "not-a-ref", state: "CAPTURED" });
    expect(res.status).toBe(400);
    expect(setPaymentStatus).not.toHaveBeenCalled();
  });

  it("STUB MODE: never flips status from a forged body", async () => {
    setEnv({}); // no merchant creds
    const res = await postCallback({ reference: ref, state: "CAPTURED" });
    const json = (await res.json()) as { ok: boolean; ignored?: string };
    expect(res.status).toBe(200);
    expect(json.ignored).toBe("stub_mode");
    expect(setPaymentStatus).not.toHaveBeenCalled();
  });

  it("CONFIGURED: ignores the body and trusts getStatus (forged CAPTURED, real CREATED → no flip)", async () => {
    setEnv(REAL_ENV);
    getStatus.mockResolvedValue({ ok: true, status: "created" }); // provider says NOT captured
    const res = await postCallback({ reference: ref, state: "CAPTURED" }); // forged
    expect(res.status).toBe(200);
    // created → deposit_pending, not a terminal upgrade → no write.
    expect(setPaymentStatus).not.toHaveBeenCalled();
  });

  it("CONFIGURED: flips deposit_paid only when getStatus confirms CAPTURED", async () => {
    setEnv(REAL_ENV);
    getStatus.mockResolvedValue({ ok: true, status: "captured" });
    const res = await postCallback({ reference: ref, state: "anything" });
    expect(res.status).toBe(200);
    expect(setPaymentStatus).toHaveBeenCalledTimes(1);
    expect(setPaymentStatus.mock.calls[0]?.[0]).toMatchObject({ status: "deposit_paid" });
  });

  it("CONFIGURED: fails closed (no flip) when getStatus cannot confirm", async () => {
    setEnv(REAL_ENV);
    getStatus.mockResolvedValue({ ok: false, status: "failed" });
    const res = await postCallback({ reference: ref, state: "CAPTURED" }); // forged
    expect(res.status).toBe(202);
    expect(setPaymentStatus).not.toHaveBeenCalled();
  });
});
