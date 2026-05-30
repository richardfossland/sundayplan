import { describe, expect, it } from "vitest";
import { parseMemberImport } from "./import";

describe("parseMemberImport", () => {
  it("parses a headered CSV with mixed columns", () => {
    const text = [
      "name,phone,email,household,tags",
      "Ada Hansen,+4791234567,ada@x.no,Hansen,worship|tech",
      "Bo Olsen,90011223,,Olsen,",
    ].join("\n");
    const r = parseMemberImport(text);
    expect(r.errors).toEqual([]);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toEqual({
      display_name: "Ada Hansen",
      phone_e164: "+4791234567",
      email: "ada@x.no",
      household: "Hansen",
      tags: ["worship", "tech"],
    });
    // bare Norwegian mobile gets +47, blank email/tags → null/[]
    expect(r.rows[1].phone_e164).toBe("+4790011223");
    expect(r.rows[1].email).toBeNull();
    expect(r.rows[1].tags).toEqual([]);
  });

  it("treats a delimiter-only first line as positional (no header)", () => {
    const r = parseMemberImport("Ada,+4791234567\nBo,+4790011223");
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0].display_name).toBe("Ada");
  });

  it("detects tab and semicolon delimiters", () => {
    expect(parseMemberImport("Ada\t+4791234567").rows[0].phone_e164).toBe("+4791234567");
    expect(parseMemberImport("Ada;+4791234567").rows[0].phone_e164).toBe("+4791234567");
  });

  it("recognises Norwegian header aliases", () => {
    const r = parseMemberImport("navn;mobil;e-post\nAda;+4791234567;ada@x.no");
    expect(r.rows[0]).toMatchObject({ display_name: "Ada", phone_e164: "+4791234567", email: "ada@x.no" });
  });

  it("reports per-line errors without failing the batch", () => {
    const text = ["Ada,+4791234567", ",+4790011223", "Cy,not-a-phone", "Di,+4799887766,bad-email"].join("\n");
    const r = parseMemberImport(text);
    expect(r.rows.map((x) => x.display_name)).toEqual(["Ada"]);
    expect(r.errors).toEqual([
      { line: 2, message: "missing name" },
      { line: 3, message: 'invalid phone "not-a-phone"' },
      { line: 4, message: 'invalid email "bad-email"' },
    ]);
  });

  it("dedupes within the paste by phone then name", () => {
    const text = ["Ada,+4791234567", "Ada Again,+4791234567", "Bo", "Bo"].join("\n");
    const r = parseMemberImport(text);
    expect(r.rows.map((x) => x.display_name)).toEqual(["Ada", "Bo"]);
    expect(r.duplicates).toBe(2);
  });

  it("normalizes 00-prefixed international numbers", () => {
    expect(parseMemberImport("Ada,004791234567").rows[0].phone_e164).toBe("+4791234567");
  });

  it("returns empty for blank input", () => {
    expect(parseMemberImport("   \n  ").rows).toEqual([]);
  });
});
