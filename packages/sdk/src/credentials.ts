/**
 * Credential gating — background-check / certification enforcement (GraceSquad).
 * Pure, deterministic helpers the data layer uses to keep a member out of
 * auto-fill (and flag the schedule) until a required credential is current.
 *
 * A credential is "current" only if its status says so AND it hasn't expired.
 */
export type CredentialKind =
  | "background_check"
  | "cpr"
  | "first_aid"
  | "safeguarding"
  | "drivers_license"
  | "other";

export type CredentialStatus = "current" | "pending" | "expired" | "none";

const DAY_MS = 86_400_000;

/** The six credential kinds, in display order — the canonical UI source. */
export const CREDENTIAL_KINDS: readonly CredentialKind[] = [
  "background_check",
  "cpr",
  "first_aid",
  "safeguarding",
  "drivers_license",
  "other",
] as const;

/** The credential statuses a planner can set, in display order. */
export const CREDENTIAL_STATUSES: readonly CredentialStatus[] = [
  "current",
  "pending",
  "expired",
  "none",
] as const;

export function isCredentialKind(v: unknown): v is CredentialKind {
  return typeof v === "string" && (CREDENTIAL_KINDS as readonly string[]).includes(v);
}

export function isCredentialStatus(v: unknown): v is CredentialStatus {
  return typeof v === "string" && (CREDENTIAL_STATUSES as readonly string[]).includes(v);
}

export interface MemberCredential {
  kind: CredentialKind;
  status: CredentialStatus;
  /** ISO date; when set, a past date means expired regardless of status. */
  expires_at?: string | null;
}

/** Matches a date-only ISO string (`YYYY-MM-DD`), the form we store/collect. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The instant a credential's expiry actually lapses. A date-only `expires_at`
 * (the convention used by the DB and the `<input type=date>`) means the
 * certification is valid *through the end of that calendar day*, so it lapses
 * at the start of the following day — not at UTC-midnight of the expiry day,
 * which would wrongly mark a still-valid credential expired all day. A full
 * timestamp, if ever supplied, is honoured exactly.
 */
function expiryInstant(expires_at: string): number {
  if (DATE_ONLY.test(expires_at)) {
    return new Date(`${expires_at}T00:00:00Z`).getTime() + DAY_MS;
  }
  return new Date(expires_at).getTime();
}

/** True if this single credential is valid right now. */
export function isCredentialCurrent(cred: MemberCredential | undefined, now: Date = new Date()): boolean {
  if (!cred || cred.status !== "current") return false;
  if (cred.expires_at) return expiryInstant(cred.expires_at) > now.getTime();
  return true;
}

/**
 * Which of the `required` credentials a member does NOT currently hold. An
 * empty array means the member is cleared for the role.
 */
export function missingCredentials(
  required: CredentialKind[],
  held: MemberCredential[],
  now: Date = new Date(),
): CredentialKind[] {
  const byKind = new Map(held.map((c) => [c.kind, c]));
  return required.filter((kind) => !isCredentialCurrent(byKind.get(kind), now));
}

/** Convenience gate: should this member be blocked from a role requiring these? */
export function isBlockedByCredentials(
  required: CredentialKind[],
  held: MemberCredential[],
  now: Date = new Date(),
): boolean {
  return missingCredentials(required, held, now).length > 0;
}

// ── Input validation (used by the web server actions) ─────────────────────────
// Plain parsers so a server action can validate a credential form / a role's
// required-credential set without a Supabase round-trip — and so the rules are
// unit-testable in isolation.

/** A validated credential record ready to upsert (dates kept as ISO strings). */
export interface CredentialInput {
  kind: CredentialKind;
  status: CredentialStatus;
  issued_at: string | null;
  expires_at: string | null;
  notes: string | null;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** ISO `YYYY-MM-DD` from an `<input type=date>`, or null when blank. */
function parseDate(v: unknown): { ok: true; value: string | null } | { ok: false } {
  if (v == null) return { ok: true, value: null };
  const s = String(v).trim();
  if (s.length === 0) return { ok: true, value: null };
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? { ok: true, value: s } : { ok: false };
}

/**
 * Validate one member-credential submission. Rejects an unknown kind/status and
 * an expiry that falls before the issue date (a meaningless record).
 */
export function parseCredentialInput(raw: {
  kind?: unknown;
  status?: unknown;
  issued_at?: unknown;
  expires_at?: unknown;
  notes?: unknown;
}): ParseResult<CredentialInput> {
  if (!isCredentialKind(raw.kind)) return { ok: false, error: "Pick a credential type." };
  if (!isCredentialStatus(raw.status)) return { ok: false, error: "Pick a status." };
  const issued = parseDate(raw.issued_at);
  if (!issued.ok) return { ok: false, error: "Invalid issue date." };
  const expires = parseDate(raw.expires_at);
  if (!expires.ok) return { ok: false, error: "Invalid expiry date." };
  if (issued.value && expires.value && expires.value < issued.value) {
    return { ok: false, error: "The expiry date is before the issue date." };
  }
  const notes = typeof raw.notes === "string" ? raw.notes.trim() : "";
  return {
    ok: true,
    value: {
      kind: raw.kind,
      status: raw.status,
      issued_at: issued.value,
      expires_at: expires.value,
      notes: notes.length > 0 ? notes : null,
    },
  };
}

/**
 * Normalise a set of submitted required-credential kinds: keep only valid,
 * de-duplicated kinds in their canonical order (unknown values are dropped, so
 * a stale form can never write a bad enum into `role.required_credentials`).
 */
export function parseRequiredCredentials(values: unknown[]): CredentialKind[] {
  const set = new Set(values.filter(isCredentialKind));
  return CREDENTIAL_KINDS.filter((k) => set.has(k));
}
