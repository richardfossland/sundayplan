import { describe, it, expect } from "vitest";
import en from "./i18n/catalogs/en";
import no from "./i18n/catalogs/no";

/** no/en must stay key-for-key in parity (Norwegian-first; en is the source). */
describe("i18n catalog parity", () => {
  it("no has exactly the same keys as en", () => {
    const enKeys = Object.keys(en).sort();
    const noKeys = Object.keys(no).sort();
    const missingInNo = enKeys.filter((k) => !(k in no));
    const extraInNo = noKeys.filter((k) => !(k in en));
    expect(missingInNo, `missing in no: ${missingInNo.join(", ")}`).toEqual([]);
    expect(extraInNo, `extra in no: ${extraInNo.join(", ")}`).toEqual([]);
  });

  it("no value is non-empty for every key", () => {
    for (const [k, v] of Object.entries(no)) {
      expect(v.trim().length, `empty no value for ${k}`).toBeGreaterThan(0);
    }
  });

  it("includes the Phase 4 keys", () => {
    for (const k of ["nl.placeholder", "dash.title", "form.field.signage", "nav.dashboard"]) {
      expect(k in no).toBe(true);
      expect(k in en).toBe(true);
    }
  });
});
