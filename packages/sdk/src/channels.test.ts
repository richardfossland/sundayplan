import { describe, expect, it } from "vitest";
import {
  StubProvider,
  createProvider,
  hasRealProvider,
  type SendRequest,
} from "./channels";

const req: SendRequest = {
  channel: "sms",
  to: "+4791000001",
  body: "See you Sunday!",
  reference: "delivery-1",
};

describe("StubProvider", () => {
  it("records the send and returns success without network", async () => {
    const outbox: SendRequest[] = [];
    const provider = new StubProvider("sms", { outbox });
    const result = await provider.send(req);
    expect(result.outcome).toBe("sent");
    expect(result.provider).toBe("stub");
    expect(result.provider_message_id).toBe("stub-delivery-1");
    expect(outbox).toEqual([req]);
  });

  it("can be forced to fail for testing the failure path", async () => {
    const provider = new StubProvider("email", { failAll: true });
    const result = await provider.send({ ...req, channel: "email", to: "x@y.no" });
    expect(result.outcome).toBe("failed");
    expect(result.error).toBe("stub_forced_failure");
  });

  it("reports a flat cost estimate when configured", async () => {
    const provider = new StubProvider("sms", { costCents: 8 });
    expect((await provider.send(req)).cost_cents).toBe(8);
  });
});

describe("createProvider", () => {
  it("returns the stub for every channel by default (no secrets)", () => {
    expect(createProvider("sms").name).toBe("stub");
    expect(createProvider("email").name).toBe("stub");
    expect(createProvider("push").name).toBe("stub");
  });

  it("still returns the stub even when no real adapter exists for the env", () => {
    // env present but adapters unimplemented → must not throw, falls back to stub
    const p = createProvider("sms", { TWILIO_ACCOUNT_SID: "x", TWILIO_AUTH_TOKEN: "y" });
    expect(p.name).toBe("stub");
  });
});

describe("hasRealProvider", () => {
  it("is false with no env", () => {
    expect(hasRealProvider("sms")).toBe(false);
    expect(hasRealProvider("email")).toBe(false);
    expect(hasRealProvider("push")).toBe(false);
  });

  it("detects configured credentials per channel", () => {
    expect(hasRealProvider("sms", { TWILIO_ACCOUNT_SID: "x", TWILIO_AUTH_TOKEN: "y" })).toBe(true);
    expect(hasRealProvider("email", { RESEND_API_KEY: "k" })).toBe(true);
    expect(hasRealProvider("email", { SMTP_URL: "smtp://h" })).toBe(true);
    expect(hasRealProvider("push", { WEB_PUSH_VAPID_PRIVATE_KEY: "k" })).toBe(true);
  });
});
