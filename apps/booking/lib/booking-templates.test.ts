import { describe, expect, it } from "vitest";
import {
  BOOKING_TEMPLATE_VARIABLES,
  bookingTemplate,
  renderBookingMessage,
  renderBookingTemplate,
} from "./booking-templates";

describe("renderBookingTemplate", () => {
  it("interpolates known variables and tolerates whitespace", () => {
    const r = renderBookingTemplate("Hi at {{ booking_time }} for {{facility_name}}", {
      booking_time: "10:00",
      facility_name: "Main hall",
    });
    expect(r.text).toBe("Hi at 10:00 for Main hall");
    expect(r.used.sort()).toEqual(["booking_time", "facility_name"]);
    expect(r.missing).toEqual([]);
    expect(r.unknown).toEqual([]);
  });

  it("blanks + reports missing known variables", () => {
    const r = renderBookingTemplate("For {{facility_name}} on {{booking_date}}", {
      facility_name: "Hall",
    });
    expect(r.text).toBe("For Hall on ");
    expect(r.missing).toEqual(["booking_date"]);
  });

  it("blanks + reports unknown tokens", () => {
    const r = renderBookingTemplate("{{facility_name}} {{volunteer_name}}", {
      facility_name: "Hall",
    });
    // volunteer_name is a SUITE variable, not a booking one → unknown here.
    expect(r.unknown).toEqual(["volunteer_name"]);
    expect(r.text).toBe("Hall ");
  });

  it("treats an empty-string value as missing", () => {
    const r = renderBookingTemplate("{{church_name}}", { church_name: "" });
    expect(r.missing).toEqual(["church_name"]);
  });
});

describe("bookingTemplate / renderBookingMessage", () => {
  it("has a Norwegian + English body for every key", () => {
    for (const key of ["booking_requested", "booking_approved", "booking_declined", "booking_reminder"] as const) {
      expect(bookingTemplate(key, "no").body).toBeTruthy();
      expect(bookingTemplate(key, "en").body).toBeTruthy();
    }
  });

  it("falls back to English for an unknown locale", () => {
    expect(bookingTemplate("booking_approved", "de")).toEqual(
      bookingTemplate("booking_approved", "en"),
    );
  });

  it("renders a full booking_requested message with all variables", () => {
    const { subject, body, missing } = renderBookingMessage("booking_requested", "no", {
      facility_name: "Storsalen",
      booking_date: "16.06.2026",
      booking_time: "10:00",
      church_name: "Testkirken",
      status_link: "https://x/r/abc",
    });
    expect(missing).toEqual([]);
    expect(subject).toContain("Storsalen");
    expect(body).toContain("16.06.2026");
    expect(body).toContain("https://x/r/abc");
    expect(body).toContain("Testkirken");
  });

  it("every built-in body only references known booking variables", () => {
    const known = new Set<string>(BOOKING_TEMPLATE_VARIABLES);
    for (const key of ["booking_requested", "booking_approved", "booking_declined", "booking_reminder"] as const) {
      for (const loc of ["no", "en"] as const) {
        const tpl = bookingTemplate(key, loc);
        const r = renderBookingTemplate(tpl.body, {});
        // No unknown tokens; every referenced var is in the known set.
        expect(r.unknown).toEqual([]);
        for (const m of r.missing) expect(known.has(m)).toBe(true);
      }
    }
  });
});
