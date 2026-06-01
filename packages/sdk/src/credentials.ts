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

export interface MemberCredential {
  kind: CredentialKind;
  status: CredentialStatus;
  /** ISO date; when set, a past date means expired regardless of status. */
  expires_at?: string | null;
}

/** True if this single credential is valid right now. */
export function isCredentialCurrent(cred: MemberCredential | undefined, now: Date = new Date()): boolean {
  if (!cred || cred.status !== "current") return false;
  if (cred.expires_at) return new Date(cred.expires_at).getTime() >= now.getTime();
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
