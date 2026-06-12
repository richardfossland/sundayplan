import { describe, expect, it } from "vitest";
import type { SendRequest } from "../channels";
import { TwilioSmsProvider } from "./twilio";

const ENV = {
  TWILIO_ACCOUNT_SID: "AC123",
  TWILIO_AUTH_TOKEN: "secret",
  TWILIO_FROM: "+15550100000",
};

const req: SendRequest = {
  channel: "sms",
  to: "912 34 567",
  body: "Du er satt opp på lovsang søndag.",
  reference: "delivery-1",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("TwilioSmsProvider", () => {
  it("posts a normalized E.164 number and returns the message sid", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const provider = new TwilioSmsProvider(ENV, async (url, init) => {
      calls.push({ url, init });
      return jsonResponse(201, { sid: "SM1", status: "queued" });
    });

    const result = await provider.send(req);

    expect(result).toMatchObject({ outcome: "sent", provider: "twilio", provider_message_id: "SM1" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json");
    const body = new URLSearchParams(String(calls[0].init?.body));
    expect(body.get("To")).toBe("+4791234567");
    expect(body.get("From")).toBe("+15550100000");
    expect(body.get("Body")).toBe(req.body);
    expect(String(calls[0].init?.headers && (calls[0].init.headers as Record<string, string>).Authorization)).toMatch(/^Basic /);
  });

  it("prefers a messaging service sid over a from number", async () => {
    const provider = new TwilioSmsProvider(
      { ...ENV, TWILIO_MESSAGING_SERVICE_SID: "MG9" },
      async (_url, init) => {
        const body = new URLSearchParams(String(init?.body));
        expect(body.get("MessagingServiceSid")).toBe("MG9");
        expect(body.get("From")).toBeNull();
        return jsonResponse(201, { sid: "SM2" });
      },
    );
    expect((await provider.send(req)).outcome).toBe("sent");
  });

  it("maps Twilio API errors to a failed result (never throws)", async () => {
    const provider = new TwilioSmsProvider(ENV, async () =>
      jsonResponse(400, { code: 21211, message: "Invalid 'To' Phone Number" }),
    );
    const result = await provider.send(req);
    expect(result.outcome).toBe("failed");
    expect(result.error).toContain("twilio_error_21211");
  });

  it("maps network failures to a failed result", async () => {
    const provider = new TwilioSmsProvider(ENV, async () => {
      throw new Error("ECONNRESET");
    });
    const result = await provider.send(req);
    expect(result.outcome).toBe("failed");
    expect(result.error).toContain("twilio_network_error");
  });

  it("fails fast on an unnormalizable destination without calling the API", async () => {
    let called = false;
    const provider = new TwilioSmsProvider(ENV, async () => {
      called = true;
      return jsonResponse(201, {});
    });
    const result = await provider.send({ ...req, to: "ikke et nummer" });
    expect(result.outcome).toBe("failed");
    expect(result.error).toContain("invalid_phone");
    expect(called).toBe(false);
  });

  it("fails with a clear config error when the sender is missing", async () => {
    const provider = new TwilioSmsProvider(
      { TWILIO_ACCOUNT_SID: "AC123", TWILIO_AUTH_TOKEN: "secret" },
      async () => jsonResponse(201, {}),
    );
    const result = await provider.send(req);
    expect(result.outcome).toBe("failed");
    expect(result.error).toContain("TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM");
  });

  it("estimates cost from segments when a per-segment price is configured", async () => {
    const provider = new TwilioSmsProvider(
      { ...ENV, SMS_COST_CENTS_PER_SEGMENT: "49" },
      async () => jsonResponse(201, { sid: "SM3" }),
    );
    const result = await provider.send({ ...req, body: "a".repeat(161) });
    expect(result.cost_cents).toBe(98);
  });
});
