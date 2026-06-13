import { describe, expect, it } from "vitest";
import {
  escapeHtml,
  formatNok,
  renderRentalAgreement,
  LIABILITY_CLAUSE_NO,
  type RentalSnapshot,
} from "./rental-agreement";

function snap(overrides: Partial<RentalSnapshot> = {}): RentalSnapshot {
  return {
    church: { name: "Bortelands kapell", org_no: "999 888 777" },
    renter: { name: "Kari Nordmann", contact: "kari@example.no" },
    resource: { name: "Festsalen", kind: "room" },
    date: { starts_at_utc: "2026-08-01T12:00:00Z", ends_at_utc: "2026-08-01T18:00:00Z" },
    price_nok: 2500,
    deposit_pct: 20,
    cancellation_policy: "Gratis avbestilling inntil 14 dager før.",
    terms: "Lokalet skal ryddes etter bruk.",
    captured_at: "2026-06-13T09:00:00Z",
    ...overrides,
  };
}

describe("escapeHtml", () => {
  it("escapes the five XML-significant chars", () => {
    expect(escapeHtml(`<a href="x">Tom & 'Jerry'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt;",
    );
  });
});

describe("formatNok", () => {
  it("groups thousands with a space and keeps two decimals", () => {
    expect(formatNok(2500)).toBe("2 500,00 kr");
    expect(formatNok(1234567.5)).toBe("1 234 567,50 kr");
    expect(formatNok(0)).toBe("0,00 kr");
  });
});

describe("renderRentalAgreement", () => {
  it("renders all snapshot fields", () => {
    const { html, depositNok } = renderRentalAgreement(snap());
    expect(depositNok).toBe(500); // 20% of 2500
    expect(html).toContain("Bortelands kapell");
    expect(html).toContain("999 888 777");
    expect(html).toContain("Kari Nordmann");
    expect(html).toContain("kari@example.no");
    expect(html).toContain("Festsalen");
    expect(html).toContain("01.08.2026 kl. 12:00");
    expect(html).toContain("01.08.2026 kl. 18:00");
    expect(html).toContain("2 500,00 kr"); // price
    expect(html).toContain("500,00 kr"); // deposit
    expect(html).toContain("20 %");
    expect(html).toContain("Gratis avbestilling inntil 14 dager før.");
    expect(html).toContain("Lokalet skal ryddes etter bruk.");
    expect(html).toContain(LIABILITY_CLAUSE_NO);
    expect(html).toContain('lang="no"');
  });

  it("is deterministic — same snapshot, same bytes", () => {
    expect(renderRentalAgreement(snap()).html).toBe(renderRentalAgreement(snap()).html);
  });

  it("escapes injected HTML in renter/church/terms", () => {
    const { html } = renderRentalAgreement(
      snap({
        renter: { name: "<script>alert(1)</script>", contact: "x@y.no" },
        terms: "a & b < c",
      }),
    );
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("a &amp; b &lt; c");
  });

  it("shows 'Gratis' and no deposit row for a free booking", () => {
    const { html, depositNok } = renderRentalAgreement(
      snap({ price_nok: 0, deposit_pct: 0 }),
    );
    expect(depositNok).toBe(0);
    expect(html).toContain("Gratis");
    expect(html).not.toContain("Depositum");
  });

  it("omits cancellation/terms sections when absent", () => {
    const { html } = renderRentalAgreement(
      snap({ cancellation_policy: null, terms: null }),
    );
    expect(html).not.toContain("<h2>Avbestilling</h2>");
    expect(html).not.toContain("<h2>Vilkår</h2>");
    // Liability clause is always present.
    expect(html).toContain("<h2>Ansvar</h2>");
  });

  it("rounds the deposit to two decimals", () => {
    const { depositNok } = renderRentalAgreement(snap({ price_nok: 999, deposit_pct: 33 }));
    expect(depositNok).toBe(329.67);
  });
});
