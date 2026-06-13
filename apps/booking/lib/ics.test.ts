import { describe, it, expect } from "vitest";
import {
  escapeIcsText,
  formatIcsUtc,
  foldLine,
  buildIcsCalendar,
  type IcsEvent,
} from "./ics";

const DTSTAMP = new Date("2026-06-13T08:00:00Z");
const OPTS = {
  calName: "Storsalen — SundayBooking",
  uidDomain: "booking.sundaysuite.app",
  dtstamp: DTSTAMP,
};

describe("escapeIcsText", () => {
  it("escapes backslash, comma, semicolon and newlines", () => {
    expect(escapeIcsText("a,b;c\\d")).toBe("a\\,b\\;c\\\\d");
    expect(escapeIcsText("line1\nline2")).toBe("line1\\nline2");
    expect(escapeIcsText("crlf\r\nx")).toBe("crlf\\nx");
  });
});

describe("formatIcsUtc", () => {
  it("emits a Z-suffixed UTC stamp", () => {
    expect(formatIcsUtc("2026-05-18T12:30:00Z")).toBe("20260518T123000Z");
  });
  it("converts a non-UTC offset to UTC", () => {
    // 14:00+02:00 → 12:00Z
    expect(formatIcsUtc("2026-05-18T14:00:00+02:00")).toBe("20260518T120000Z");
  });
});

describe("foldLine", () => {
  it("leaves short lines untouched", () => {
    expect(foldLine("SUMMARY:Hi")).toBe("SUMMARY:Hi");
  });
  it("folds long lines with a leading-space continuation", () => {
    const long = "DESCRIPTION:" + "x".repeat(200);
    const folded = foldLine(long);
    const parts = folded.split("\r\n");
    expect(parts.length).toBeGreaterThan(1);
    // continuation lines start with a single space
    for (let i = 1; i < parts.length; i++) {
      expect(parts[i].startsWith(" ")).toBe(true);
    }
    // unfolding reconstructs the original
    const unfolded = parts.map((p, i) => (i === 0 ? p : p.slice(1))).join("");
    expect(unfolded).toBe(long);
  });
});

describe("buildIcsCalendar", () => {
  const events: IcsEvent[] = [
    {
      uid: "bk-1",
      start: "2026-05-18T12:00:00Z",
      end: "2026-05-18T13:30:00Z",
      summary: "Konfirmasjon",
      location: "Storsalen",
      description: "60 stoler; projektor",
      status: "approved",
    },
    {
      uid: "bk-2",
      start: "2026-05-19T18:00:00Z",
      end: "2026-05-19T20:00:00Z",
      summary: "Korøvelse",
      status: "pending",
    },
  ];

  it("produces a well-formed VCALENDAR with one VEVENT per booking", () => {
    const ics = buildIcsCalendar(events, OPTS);
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
    expect((ics.match(/BEGIN:VEVENT/g) ?? []).length).toBe(2);
    expect((ics.match(/END:VEVENT/g) ?? []).length).toBe(2);
  });

  it("emits per-booking UID with the domain, UTC DTSTART/DTEND and STATUS", () => {
    const ics = buildIcsCalendar(events, OPTS);
    expect(ics).toContain("UID:bk-1@booking.sundaysuite.app");
    expect(ics).toContain("DTSTART:20260518T120000Z");
    expect(ics).toContain("DTEND:20260518T133000Z");
    expect(ics).toContain("DTSTAMP:20260613T080000Z");
    expect(ics).toContain("STATUS:CONFIRMED"); // approved
    expect(ics).toContain("STATUS:TENTATIVE"); // pending
    expect(ics).toContain("SUMMARY:Konfirmasjon");
    expect(ics).toContain("LOCATION:Storsalen");
  });

  it("escapes special chars in the DESCRIPTION", () => {
    const ics = buildIcsCalendar(events, OPTS);
    expect(ics).toContain("DESCRIPTION:60 stoler\\; projektor");
  });

  it("uses CRLF line endings throughout", () => {
    const ics = buildIcsCalendar(events, OPTS);
    // every newline is a CRLF (no lone LF)
    expect(/[^\r]\n/.test(ics)).toBe(false);
  });

  it("handles an empty booking list (valid empty calendar)", () => {
    const ics = buildIcsCalendar([], OPTS);
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("END:VCALENDAR");
    expect(ics).not.toContain("BEGIN:VEVENT");
  });
});
