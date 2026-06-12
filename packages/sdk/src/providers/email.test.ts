import { describe, expect, it } from "vitest";
import type { SendRequest } from "../channels";
import { ResendEmailProvider } from "./resend";
import { SmtpEmailProvider, type MailTransport } from "./smtp";

const req: SendRequest = {
  channel: "email",
  to: "ola@kirke.no",
  subject: "Du er satt opp",
  body: "Hei! Du er satt opp på lyd søndag 10:00.",
  reference: "delivery-2",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("ResendEmailProvider", () => {
  const ENV = { RESEND_API_KEY: "re_x", EMAIL_FROM: "SundayPlan <plan@mail.sundaysuite.app>" };

  it("posts to the Resend API with bearer auth and returns the id", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const provider = new ResendEmailProvider(ENV, async (url, init) => {
      calls.push({ url, init });
      return jsonResponse(200, { id: "email-1" });
    });

    const result = await provider.send(req);

    expect(result).toMatchObject({ outcome: "sent", provider: "resend", provider_message_id: "email-1" });
    expect(calls[0].url).toBe("https://api.resend.com/emails");
    const payload = JSON.parse(String(calls[0].init?.body)) as Record<string, unknown>;
    expect(payload.from).toBe(ENV.EMAIL_FROM);
    expect(payload.to).toEqual(["ola@kirke.no"]);
    expect(payload.subject).toBe("Du er satt opp");
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe("Bearer re_x");
  });

  it("fails with config guidance when EMAIL_FROM is missing", async () => {
    const provider = new ResendEmailProvider({ RESEND_API_KEY: "re_x" }, async () =>
      jsonResponse(200, {}),
    );
    const result = await provider.send(req);
    expect(result.outcome).toBe("failed");
    expect(result.error).toContain("EMAIL_FROM");
  });

  it("maps API errors and network errors to failed results", async () => {
    const apiErr = new ResendEmailProvider(ENV, async () =>
      jsonResponse(422, { name: "validation_error", message: "Invalid `to`" }),
    );
    expect((await apiErr.send(req)).error).toContain("resend_error_422");

    const netErr = new ResendEmailProvider(ENV, async () => {
      throw new Error("ETIMEDOUT");
    });
    expect((await netErr.send(req)).error).toContain("resend_network_error");
  });

  it("rejects an obviously invalid email without calling the API", async () => {
    let called = false;
    const provider = new ResendEmailProvider(ENV, async () => {
      called = true;
      return jsonResponse(200, {});
    });
    const result = await provider.send({ ...req, to: "ikke-epost" });
    expect(result.outcome).toBe("failed");
    expect(called).toBe(false);
  });
});

describe("SmtpEmailProvider", () => {
  const ENV = { SMTP_URL: "smtp://u:p@mail.example.com:587", EMAIL_FROM: "plan@kirke.no" };

  it("sends through the injected transport", async () => {
    const sent: unknown[] = [];
    const transport: MailTransport = {
      async sendMail(msg) {
        sent.push(msg);
        return { messageId: "<m1@mail>" };
      },
    };
    const provider = new SmtpEmailProvider(ENV, transport);
    const result = await provider.send(req);
    expect(result).toMatchObject({ outcome: "sent", provider: "smtp", provider_message_id: "<m1@mail>" });
    expect(sent).toEqual([
      { from: "plan@kirke.no", to: "ola@kirke.no", subject: "Du er satt opp", text: req.body },
    ]);
  });

  it("maps transport failures to a failed result", async () => {
    const provider = new SmtpEmailProvider(ENV, {
      async sendMail() {
        throw new Error("535 auth failed");
      },
    });
    const result = await provider.send(req);
    expect(result.outcome).toBe("failed");
    expect(result.error).toContain("smtp_error");
  });

  it("fails with config guidance when unconfigured", async () => {
    const provider = new SmtpEmailProvider({}, { async sendMail() { return {}; } });
    expect((await provider.send(req)).error).toContain("SMTP_URL");
  });
});
