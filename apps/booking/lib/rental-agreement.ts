/**
 * PURE auto-rental-agreement builder (Phase 5). Renders a deterministic
 * Norwegian-language rental agreement (HTML) from a frozen snapshot of the
 * rental terms. No I/O, no Date.now(), no randomness — same snapshot in, same
 * bytes out — so the rendered HTML can be stored alongside the snapshot and the
 * renter's later e-acceptance always refers to exactly what was shown.
 *
 * The snapshot is captured at REQUEST time (price/terms frozen) and persisted in
 * booking.rental_agreement.snapshot (migration 0024). What the renter accepted
 * is what was rendered here — even if the church later changes the resource
 * price. Cryptographic token-acceptance (accepted_at + the status-link jti)
 * stands in for a wet signature; full BankID / qualified e-sign is a noted
 * future upgrade, not required now.
 */

/** The immutable record the agreement is rendered from. All money in NOK. */
export interface RentalSnapshot {
  church: { name: string; org_no?: string | null };
  renter: { name: string; contact: string };
  resource: { name: string; kind?: string | null };
  /** ISO-8601 UTC strings. */
  date: { starts_at_utc: string; ends_at_utc: string };
  /** Total rental price in NOK; null/0 for a free booking. */
  price_nok: number | null;
  /** Deposit percentage 0..100; the deposit amount is derived. */
  deposit_pct: number | null;
  /** Free-text cancellation policy (church-authored), if any. */
  cancellation_policy: string | null;
  /** Free-text event-type terms (church-authored), if any. */
  terms: string | null;
  /** ISO date the snapshot was frozen (caller-supplied for determinism). */
  captured_at: string;
}

/** Escape the five XML-significant characters. Pure. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** NOK formatting: thousands-grouped with a space, two decimals, "kr" suffix. */
export function formatNok(amount: number): string {
  const fixed = Math.round(amount * 100) / 100;
  const [intPart, decPart = "00"] = fixed.toFixed(2).split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${grouped},${decPart} kr`;
}

/** dd.mm.yyyy kl. HH:MM (UTC-stable, Norwegian). */
function fmtWhen(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()} kl. ${pad(
    d.getUTCHours(),
  )}:${pad(d.getUTCMinutes())}`;
}

/** dd.mm.yyyy (UTC-stable). */
function fmtDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
}

/** The standard liability clause (Norwegian). Constant — frozen into the doc. */
export const LIABILITY_CLAUSE_NO =
  "Leietaker er ansvarlig for skader på lokalet, inventar og utstyr som oppstår i " +
  "leieperioden, og for at lokalet forlates ryddet og i samme stand som ved overtakelse. " +
  "Utleier er ikke ansvarlig for tap av eller skade på leietakers eiendeler.";

export interface RentalAgreementResult {
  /** Computed deposit amount in NOK (0 when no price/deposit). */
  depositNok: number;
  /** The rendered, self-contained HTML document. */
  html: string;
}

/**
 * Render the agreement. Deterministic and pure: the only inputs are the
 * snapshot fields. Returns the derived deposit amount + the HTML.
 */
export function renderRentalAgreement(snap: RentalSnapshot): RentalAgreementResult {
  const price = snap.price_nok ?? 0;
  const depositPct = snap.deposit_pct ?? 0;
  const depositNok = Math.round(price * (depositPct / 100) * 100) / 100;

  const e = escapeHtml;
  const rows: string[] = [];
  const row = (label: string, value: string) =>
    `<tr><th scope="row">${e(label)}</th><td>${value}</td></tr>`;

  rows.push(row("Utleier", e(snap.church.name)));
  if (snap.church.org_no) rows.push(row("Org.nr.", e(snap.church.org_no)));
  rows.push(row("Leietaker", e(snap.renter.name)));
  rows.push(row("Kontakt", e(snap.renter.contact)));
  rows.push(row("Lokale/ressurs", e(snap.resource.name)));
  rows.push(
    row("Leieperiode", `${e(fmtWhen(snap.date.starts_at_utc))} – ${e(fmtWhen(snap.date.ends_at_utc))}`),
  );

  if (price > 0) {
    rows.push(row("Leiepris", e(formatNok(price))));
    if (depositPct > 0) {
      rows.push(
        row("Depositum", `${e(formatNok(depositNok))} (${e(String(depositPct))} %)`),
      );
    }
  } else {
    rows.push(row("Leiepris", "Gratis"));
  }

  const cancellationHtml = snap.cancellation_policy
    ? `<section class="clause"><h2>Avbestilling</h2><p>${e(snap.cancellation_policy)}</p></section>`
    : "";
  const termsHtml = snap.terms
    ? `<section class="clause"><h2>Vilkår</h2><p>${e(snap.terms)}</p></section>`
    : "";

  const html =
    `<!doctype html><html lang="no"><head><meta charset="utf-8">` +
    `<title>Leieavtale — ${e(snap.resource.name)}</title>` +
    `<style>` +
    `body{font-family:system-ui,-apple-system,sans-serif;color:#1a1a2e;line-height:1.55;max-width:46rem;margin:0 auto;padding:1.5rem}` +
    `h1{font-size:1.5rem;margin:0 0 .25rem}h2{font-size:1.05rem;margin:1.25rem 0 .35rem}` +
    `.meta{color:#555;font-size:.85rem;margin-bottom:1rem}` +
    `table{border-collapse:collapse;width:100%;margin:1rem 0}` +
    `th,td{text-align:left;padding:.4rem .6rem;border-bottom:1px solid #e3e3ec;vertical-align:top}` +
    `th[scope=row]{width:14rem;color:#444;font-weight:600}` +
    `.clause p{margin:.25rem 0}` +
    `</style></head><body>` +
    `<h1>Leieavtale</h1>` +
    `<p class="meta">Avtale opprettet ${e(fmtDate(snap.captured_at))} mellom utleier og leietaker.</p>` +
    `<table>${rows.join("")}</table>` +
    cancellationHtml +
    termsHtml +
    `<section class="clause"><h2>Ansvar</h2><p>${e(LIABILITY_CLAUSE_NO)}</p></section>` +
    `<section class="clause"><h2>Aksept</h2><p>Ved å bekrefte denne avtalen elektronisk ` +
    `godtar leietaker vilkårene ovenfor. Elektronisk aksept registreres med tidspunkt og ` +
    `en unik referanse knyttet til leietakers tilgangslenke.</p></section>` +
    `</body></html>`;

  return { depositNok, html };
}
