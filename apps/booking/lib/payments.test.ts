import { describe, expect, it } from "vitest";
import {
  buildVippsCreateBody,
  createPaymentProvider,
  nokToOre,
  parseVippsState,
  paymentStatusToBookingStatus,
  paymentsConfigured,
  RealVippsProvider,
  StubVippsProvider,
  type CreatePaymentInput,
} from "./payments";

const REAL_ENV = {
  VIPPS_CLIENT_ID: "id",
  VIPPS_CLIENT_SECRET: "secret",
  VIPPS_SUBSCRIPTION_KEY: "sub",
  VIPPS_MSN: "123456",
};

const intent = (o: Partial<CreatePaymentInput> = {}): CreatePaymentInput => ({
  amountNok: 500,
  reference: "booking:abc:deposit",
  returnUrl: "https://booking.sundaysuite.app/r/TOKEN",
  description: "Depositum Festsalen",
  ...o,
});

describe("nokToOre", () => {
  it("converts NOK to øre, rounding", () => {
    expect(nokToOre(500)).toBe(50000);
    expect(nokToOre(329.67)).toBe(32967);
  });
});

describe("paymentsConfigured", () => {
  it("is false without all four creds", () => {
    expect(paymentsConfigured({})).toBe(false);
    expect(paymentsConfigured({ VIPPS_CLIENT_ID: "x" })).toBe(false);
  });
  it("is true only with all four creds", () => {
    expect(paymentsConfigured(REAL_ENV)).toBe(true);
  });
});

describe("createPaymentProvider", () => {
  it("returns the stub when unconfigured", () => {
    expect(createPaymentProvider({}).name).toBe("stub");
  });
  it("returns the real provider when configured", () => {
    expect(createPaymentProvider(REAL_ENV).name).toBe("vipps");
  });
});

describe("buildVippsCreateBody (pure)", () => {
  it("builds the ePayment body in øre with NOK + WEB_REDIRECT", () => {
    const body = buildVippsCreateBody(intent());
    expect(body).toEqual({
      amount: { currency: "NOK", value: 50000 },
      paymentMethod: { type: "WALLET" },
      reference: "booking:abc:deposit",
      returnUrl: "https://booking.sundaysuite.app/r/TOKEN",
      userFlow: "WEB_REDIRECT",
      paymentDescription: "Depositum Festsalen",
    });
  });
  it("caps reference at 50 chars and description at 100", () => {
    const body = buildVippsCreateBody(
      intent({ reference: "x".repeat(80), description: "y".repeat(200) }),
    );
    expect(body.reference.length).toBe(50);
    expect(body.paymentDescription.length).toBe(100);
  });
});

describe("parseVippsState (pure)", () => {
  it("maps known states", () => {
    expect(parseVippsState("CREATED")).toBe("created");
    expect(parseVippsState("authorized")).toBe("authorized");
    expect(parseVippsState("CAPTURED")).toBe("captured");
    expect(parseVippsState("REFUNDED")).toBe("refunded");
    expect(parseVippsState("ABORTED")).toBe("failed");
    expect(parseVippsState("EXPIRED")).toBe("failed");
  });
  it("defaults unknown/empty to created", () => {
    expect(parseVippsState(undefined)).toBe("created");
    expect(parseVippsState("???")).toBe("created");
  });
});

describe("paymentStatusToBookingStatus (pure)", () => {
  it("maps a deposit capture to deposit_paid and full capture to paid", () => {
    expect(paymentStatusToBookingStatus("captured", true)).toBe("deposit_paid");
    expect(paymentStatusToBookingStatus("captured", false)).toBe("paid");
  });
  it("maps created/authorized/stub to deposit_pending", () => {
    expect(paymentStatusToBookingStatus("stub", true)).toBe("deposit_pending");
    expect(paymentStatusToBookingStatus("created", true)).toBe("deposit_pending");
    expect(paymentStatusToBookingStatus("authorized", true)).toBe("deposit_pending");
  });
  it("maps refunded/failed", () => {
    expect(paymentStatusToBookingStatus("refunded", true)).toBe("refunded");
    expect(paymentStatusToBookingStatus("failed", true)).toBe("none");
  });
});

describe("StubVippsProvider", () => {
  it("records the intent and returns a fake redirect with stub marker (no network)", async () => {
    const outbox: CreatePaymentInput[] = [];
    const p = new StubVippsProvider({ outbox });
    const r = await p.createPayment(intent());
    expect(r.ok).toBe(true);
    expect(r.provider).toBe("stub");
    expect(r.status).toBe("stub");
    expect(r.redirectUrl).toContain("stub=1");
    expect(r.redirectUrl).toContain("reference=booking%3Aabc%3Adeposit");
    expect(outbox).toHaveLength(1);
  });
  it("appends with & when returnUrl already has a query", async () => {
    const r = await new StubVippsProvider().createPayment(
      intent({ returnUrl: "https://x.test/r/T?a=1" }),
    );
    expect(r.redirectUrl).toContain("?a=1&stub=1");
  });
  it("can be forced to fail", async () => {
    const r = await new StubVippsProvider({ failAll: true }).createPayment(intent());
    expect(r.ok).toBe(false);
    expect(r.status).toBe("failed");
  });
  it("getStatus returns stub, refund returns refunded", async () => {
    const p = new StubVippsProvider();
    expect((await p.getStatus("ref")).status).toBe("stub");
    expect((await p.refundPayment("ref", 500)).status).toBe("refunded");
  });
});

describe("RealVippsProvider (canned fetch, no network)", () => {
  function fakeFetch(responses: Record<string, { status: number; body: unknown }>) {
    return async (url: string): Promise<Response> => {
      const key = Object.keys(responses).find((k) => url.includes(k));
      const r = key ? responses[key] : { status: 404, body: {} };
      return new Response(JSON.stringify(r.body), { status: r.status });
    };
  }

  it("creates a payment: auth then ePayment create", async () => {
    const f = fakeFetch({
      "/accesstoken/get": { status: 200, body: { access_token: "tok", expires_in: 3600 } },
      "/epayment/v1/payments": {
        status: 201,
        body: { reference: "booking:abc:deposit", redirectUrl: "https://vipps/landing" },
      },
    });
    const p = new RealVippsProvider(REAL_ENV, f);
    const r = await p.createPayment(intent());
    expect(r.ok).toBe(true);
    expect(r.provider).toBe("vipps");
    expect(r.redirectUrl).toBe("https://vipps/landing");
    expect(r.status).toBe("created");
  });

  it("fails gracefully when auth fails", async () => {
    const f = fakeFetch({ "/accesstoken/get": { status: 401, body: {} } });
    const r = await new RealVippsProvider(REAL_ENV, f).createPayment(intent());
    expect(r.ok).toBe(false);
    expect(r.error).toBe("vipps_auth_failed");
  });

  it("parses status via getStatus", async () => {
    const f = fakeFetch({
      "/accesstoken/get": { status: 200, body: { access_token: "tok", expires_in: 3600 } },
      "/epayment/v1/payments/": { status: 200, body: { state: "CAPTURED" } },
    });
    const r = await new RealVippsProvider(REAL_ENV, f).getStatus("booking:abc:deposit");
    expect(r.ok).toBe(true);
    expect(r.status).toBe("captured");
  });
});
