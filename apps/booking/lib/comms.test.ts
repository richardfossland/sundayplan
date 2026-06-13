import { describe, expect, it, beforeAll } from "vitest";
import { channelForContact } from "./comms";
import { signBookingStatus, verifyBookingStatus } from "@sundayplan/auth";

describe("channelForContact", () => {
  it("detects email", () => {
    expect(channelForContact("renter@example.com")).toBe("email");
    expect(channelForContact("  a.b+tag@sub.domain.no ")).toBe("email");
  });
  it("detects phone (>=6 digits)", () => {
    expect(channelForContact("+47 900 12 345")).toBe("sms");
    expect(channelForContact("90012345")).toBe("sms");
  });
  it("returns null for unusable contacts", () => {
    expect(channelForContact(null)).toBe(null);
    expect(channelForContact("")).toBe(null);
    expect(channelForContact("12345")).toBe(null); // only 5 digits
  });
});

// Claim-shape mapping: a booking-status token round-trips to the (bookingId,
// churchId) the renter-status path relies on, and rejects the wrong family.
describe("booking-status claim shape", () => {
  const SECRET = "booking-test-secret";
  let token: string;
  beforeAll(async () => {
    token = await signBookingStatus(
      {
        booking_id: "44444444-4444-4444-8444-444444444444",
        church_id: "22222222-2222-4222-8222-222222222222",
        ttl_seconds: 3600,
        now: 1_700_000_000,
      },
      SECRET,
    );
  });

  it("maps a verified claim to bookingId + churchId", async () => {
    const res = await verifyBookingStatus(token, SECRET, 1_700_000_000);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.claims.booking_id).toBe("44444444-4444-4444-8444-444444444444");
    expect(res.claims.church_id).toBe("22222222-2222-4222-8222-222222222222");
    expect(res.claims.purpose).toBe("booking_status");
  });

  it("rejects a different secret", async () => {
    const res = await verifyBookingStatus(token, "nope", 1_700_000_000);
    expect(res).toEqual({ ok: false, reason: "bad_signature" });
  });
});
