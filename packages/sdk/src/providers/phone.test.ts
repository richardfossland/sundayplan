import { describe, expect, it } from "vitest";
import { estimateSmsCostCents, smsSegments, toE164 } from "./phone";

describe("toE164", () => {
  it("keeps already-international numbers, stripping separators", () => {
    expect(toE164("+47 912 34 567")).toBe("+4791234567");
    expect(toE164("+1 (555) 010-1234")).toBe("+15550101234");
    expect(toE164("0047 912 34 567")).toBe("+4791234567");
  });

  it("prefixes bare national numbers for the default country", () => {
    expect(toE164("91234567", "NO")).toBe("+4791234567");
    expect(toE164("912 34 567", "NO")).toBe("+4791234567");
    expect(toE164("070-123 45 67", "SE")).toBe("+46701234567");
    expect(toE164("20 12 34 56", "DK")).toBe("+4520123456");
  });

  it("rejects what it cannot normalize safely", () => {
    expect(toE164("")).toBeNull();
    expect(toE164("hei")).toBeNull();
    expect(toE164("12345", "NO")).toBeNull(); // wrong national length
    expect(toE164("91234567", "XX")).toBeNull(); // unknown country
    expect(toE164("+12")).toBeNull(); // too short to be E.164
  });
});

describe("smsSegments", () => {
  it("counts GSM-7 bodies at 160/153 per segment", () => {
    expect(smsSegments("a".repeat(160))).toBe(1);
    expect(smsSegments("a".repeat(161))).toBe(2);
    expect(smsSegments("a".repeat(306))).toBe(2);
    expect(smsSegments("a".repeat(307))).toBe(3);
  });

  it("counts GSM extension chars as two septets", () => {
    // 159 normal + € (2 septets) = 161 septets → 2 segments
    expect(smsSegments(`${"a".repeat(159)}€`)).toBe(2);
  });

  it("falls to UCS-2 at 70/67 for non-GSM characters (emoji, č, etc.)", () => {
    expect(smsSegments(`${"a".repeat(69)}č`)).toBe(1);
    expect(smsSegments(`${"a".repeat(70)}č`)).toBe(2);
  });

  it("norwegian letters æøå are GSM-7 (a real 160-char norwegian SMS is 1 segment)", () => {
    expect(smsSegments(`${"Vær så god søndag på Ås! ".repeat(6)}`.slice(0, 160))).toBe(1);
  });
});

describe("estimateSmsCostCents", () => {
  it("multiplies segments by the configured per-segment price", () => {
    expect(estimateSmsCostCents("hei", 49)).toBe(49);
    expect(estimateSmsCostCents("a".repeat(161), 49)).toBe(98);
  });

  it("stays undefined without a configured price", () => {
    expect(estimateSmsCostCents("hei", undefined)).toBeUndefined();
    expect(estimateSmsCostCents("hei", Number("not-a-number"))).toBeUndefined();
  });
});
