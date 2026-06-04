/**
 * Zod schemas mirroring `types.ts`. These run at API boundaries:
 *   - Edge Functions parse request bodies with these
 *   - Server actions in Next.js validate form inputs with these
 *   - Mobile API client double-checks responses in dev mode
 *
 * Convention: each entity has `Schema` (full row) + `InputSchema` (subset
 * accepted from clients, omitting server-managed columns).
 */

import { z } from "zod";

// ── Reusable atoms ──────────────────────────────────────────────────────────

export const uuid = z.string().uuid();
export const isoDateTime = z.string().datetime({ offset: true });
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/** RFC 5733 / E.164 phone number — `+47…`, `+1…`. */
export const phoneE164 = z.string().regex(/^\+[1-9]\d{6,14}$/);
export const localeCode = z.enum(["no", "en", "sv", "da", "de", "fr", "pl"]);

// ── Tenancy ─────────────────────────────────────────────────────────────────

export const ChurchPlanTier = z.enum(["free", "starter", "growth", "network"]);

export const ChurchInputSchema = z.object({
  name: z.string().min(1).max(120),
  slug: z.string().regex(/^[a-z0-9-]+$/).min(2).max(60),
  locale: localeCode.default("no"),
  timezone: z.string().min(1).default("Europe/Oslo"),
  denomination: z.string().optional().nullable(),
});

export const TonoStatus = z.enum([
  "none",
  "state_church_blanket",
  "direct_agreement",
  "application_pending",
  "not_applicable",
]);

export const ChurchSettingsInputSchema = z.object({
  ccli_license_number: z.string().optional().nullable(),
  ccli_size_category: z.enum(["A","B","C","D","E","F"]).optional().nullable(),
  ccli_streaming_addon: z.boolean().optional(),
  tono_license_status: TonoStatus.optional(),
  tono_customer_id: z.string().optional().nullable(),
  tono_streaming_addon: z.boolean().optional(),
  default_max_assignments_per_month: z.number().int().min(1).max(31).optional(),
  reminder_cadence: z
    .object({
      days_before: z.array(z.number().int().min(0).max(60)).max(8),
      hours_before: z.array(z.number().int().min(0).max(48)).max(8),
    })
    .optional(),
  unfilled_warn_days: z.number().int().min(1).max(60).optional(),
  max_consecutive_sundays: z.number().int().min(1).max(52).optional(),
  // 0 = off; matches the migration's check (0..90).
  min_rest_days: z.number().int().min(0).max(90).optional(),
  auto_buy_sms_overage: z.boolean().optional(),
  single_use_response_links: z.boolean().optional(),
});

/** Church-level identity fields editable from the settings page. */
export const ChurchProfileInputSchema = z.object({
  name: z.string().min(2).max(120),
  locale: localeCode,
  timezone: z.string().min(1).max(60),
  denomination: z.string().max(120).optional().nullable(),
});

// ── Member ──────────────────────────────────────────────────────────────────

export const MemberStatus = z.enum(["active", "inactive", "archived"]);
export const ContactChannel = z.enum(["sms", "email", "push"]);

export const MemberInputSchema = z.object({
  display_name: z.string().min(1).max(120),
  phone_e164: phoneE164.optional().nullable(),
  email: z.string().email().optional().nullable(),
  language: localeCode.default("no"),
  preferred_channel: ContactChannel.default("sms"),
  birthday: isoDate.optional().nullable(),
  joined_at: isoDate.optional().nullable(),
  status: MemberStatus.default("active"),
  notes: z.string().max(2000).optional().nullable(),
  tags: z.array(z.string().max(40)).max(32).default([]),
  target_serves_per_month: z.number().int().min(0).max(31).optional().nullable(),
  /** Free-text household label; members sharing it trip the family conflict rule. */
  household: z.string().max(80).optional().nullable(),
});

// ── Team / Role / Membership ────────────────────────────────────────────────

export const SkillLevel = z.enum(["training", "capable", "lead", "trainer"]);

export const TeamInputSchema = z.object({
  name: z.string().min(1).max(80),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional().nullable(),
  description: z.string().max(1000).optional().nullable(),
});

export const RoleInputSchema = z.object({
  name: z.string().min(1).max(80),
  skill_required: SkillLevel.default("capable"),
  description: z.string().max(1000).optional().nullable(),
});

export const TeamMembershipInputSchema = z.object({
  member_id: uuid,
  team_id: uuid,
  role_id: uuid,
  skill_level: SkillLevel.default("capable"),
  is_key_person: z.boolean().optional(),
  notes: z.string().max(2000).optional().nullable(),
});

// ── Availability ────────────────────────────────────────────────────────────

export const AvailabilityKind = z.enum(["recurring", "range", "specific"]);
export const AvailabilityVisibility = z.enum(["private", "planner", "team"]);

export const AvailabilityPattern = z.union([
  z.object({ weekday: z.enum([
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  ])}),
  z.object({ from: isoDate, to: isoDate }),
  z.object({ dates: z.array(isoDate).min(1) }),
]);

export const AvailabilityInputSchema = z.object({
  member_id: uuid,
  kind: AvailabilityKind,
  pattern: AvailabilityPattern,
  reason: z.string().max(500).optional().nullable(),
  reason_visibility: AvailabilityVisibility.default("planner"),
});

// ── Service ─────────────────────────────────────────────────────────────────

export const ServiceState = z.enum([
  "draft", "published", "in_progress", "played", "archived",
]);

export const ServiceInputSchema = z.object({
  template_id: uuid.optional().nullable(),
  name: z.string().min(1).max(120),
  starts_at_utc: isoDateTime,
  notes: z.string().max(4000).optional().nullable(),
});

export const ServiceItemKind = z.enum([
  "welcome", "song", "scripture", "sermon", "announcement", "gap",
]);

export const ServiceItemInputSchema = z.object({
  position: z.number().int().min(0),
  label: z.string().min(1).max(120),
  kind: ServiceItemKind,
  duration_min: z.number().int().min(0).max(360).default(0),
  notes: z.string().max(2000).optional().nullable(),
  song_id: uuid.optional().nullable(),
  scripture_ref: z.string().max(80).optional().nullable(),
});

// ── Service template ──────────────────────────────────────────────────────────

export const ServiceTemplateInputSchema = z.object({
  name: z.string().min(1).max(120),
  default_duration_min: z.number().int().min(0).max(600).default(75),
});

export const TemplateItemKind = z.enum([
  "welcome", "worship_set", "scripture", "sermon", "response", "closing", "announcement", "gap",
]);

export const TemplateItemInputSchema = z.object({
  position: z.number().int().min(0),
  label: z.string().min(1).max(120),
  kind: TemplateItemKind,
  duration_min: z.number().int().min(0).max(360).default(0),
});

export const ServiceTeamRequirementInputSchema = z.object({
  role_id: uuid,
  quantity: z.number().int().min(1).max(20).default(1),
});

// ── Song ────────────────────────────────────────────────────────────────────

export const SongInputSchema = z.object({
  title: z.string().min(1).max(200),
  author: z.string().max(200).optional().nullable(),
  ccli_song_id: z.string().max(40).optional().nullable(),
  tono_work_id: z.string().max(40).optional().nullable(),
  default_key: z.string().max(8).optional().nullable(),
  tempo_bpm: z.number().int().min(20).max(300).optional().nullable(),
  language: localeCode.default("no"),
  themes: z.array(z.string().max(40)).max(32).default([]),
  sundaysong_id: uuid.optional().nullable(),
  chord_chart_url: z.string().url().optional().nullable(),
  demo_url: z.string().url().optional().nullable(),
});

// ── Assignment ──────────────────────────────────────────────────────────────

export const AssignmentStatus = z.enum([
  "pending", "invited", "accepted", "declined", "no_response", "removed",
]);

export const AssignmentInputSchema = z.object({
  service_id: uuid,
  role_id: uuid,
  member_id: uuid,
  service_item_id: uuid.optional().nullable(),
});

export const AssignmentResponseSchema = z.object({
  /** Magic-link token; verified by the Edge Function */
  token: z.string().min(20),
  action: z.enum(["accept", "decline", "suggest_swap"]),
  reason: z.string().max(500).optional(),
});

// ── Magic-link issuance ─────────────────────────────────────────────────────

export const MagicLinkPurpose = z.enum([
  "assignment_response", "availability_set", "swap_request", "generic", "church_invite",
]);

export const MagicLinkIssueSchema = z.object({
  member_id: uuid,
  purpose: MagicLinkPurpose,
  assignment_id: uuid.optional().nullable(),
  /** Time-to-live in seconds — defaults to 7 days */
  ttl_seconds: z.number().int().min(60).max(60 * 60 * 24 * 30).default(60 * 60 * 24 * 7),
});

// ── Church invites (Phase 1.3) ──────────────────────────────────────────────────
// A planner onboards co-planners by minting a signed invite link tied to a church
// + a role, then copy-pastes it (no email/SMS provider needed). The recipient
// signs in / signs up, lands on the accept page, and a `church_member` row is
// created with the invited role. Unlike volunteer magic-links these are NOT
// member-scoped — the invitee has no `member` row, they become a planner-side
// `church_member`. The roles below are exactly the planner-side roles that can be
// granted via an invite (`viewer` isn't invitable — viewers are added directly).

/** The church_member roles a planner may grant through an invite link. */
export const ChurchInviteRole = z.enum(["admin", "planner", "team_lead"]);
export type ChurchInviteRoleName = z.infer<typeof ChurchInviteRole>;

/** Validate a `role` value from a form/query; returns the role or `null`. */
export function parseChurchInviteRole(
  raw: string | null | undefined,
): ChurchInviteRoleName | null {
  const r = ChurchInviteRole.safeParse(raw);
  return r.success ? r.data : null;
}

/** Human-facing label for each invitable role. */
export const CHURCH_INVITE_ROLE_LABELS: Record<ChurchInviteRoleName, string> = {
  admin: "Admin",
  planner: "Planner",
  team_lead: "Team lead",
};

export const ChurchInviteIssueSchema = z.object({
  church_id: uuid,
  role: ChurchInviteRole.default("planner"),
  /** Time-to-live in seconds — defaults to 14 days (an onboarding window). */
  ttl_seconds: z
    .number()
    .int()
    .min(60)
    .max(60 * 60 * 24 * 30)
    .default(60 * 60 * 24 * 14),
});

// ── Communications (Phase 6) ──────────────────────────────────────────────────
// Templates a planner authors, the outbound messages built from them, and the
// per-recipient delivery records. The SDK comms engine renders + resolves these;
// the provider layer transmits them (stubbed by default).

export const MessageChannel = z.enum(["sms", "email", "push"]);

/**
 * Why a message is being sent. Mirrors the reminder cadence so the scheduler
 * (SDK `dueMessages`) can decide which to send for a service.
 */
export const MessagePurpose = z.enum([
  "invite",
  "reminder",
  "final_reminder",
  "confirmation",
  "cancellation",
  "custom",
]);

/**
 * Variables a template may interpolate as `{{name}}`. Kept as a known set so the
 * editor can offer them and the renderer can flag unknown ones. `accept_link` /
 * `decline_link` are the Phase 7 magic-link seams.
 */
export const TemplateVariable = z.enum([
  "volunteer_name",
  "role_name",
  "team_name",
  "service_title",
  "service_date",
  "service_time",
  "church_name",
  "accept_link",
  "decline_link",
]);

export const MessageTemplateInputSchema = z.object({
  name: z.string().min(1).max(120),
  channel: MessageChannel,
  purpose: MessagePurpose.default("custom"),
  language: localeCode.default("no"),
  /** Required for email; ignored for sms/push (push uses it as the title). */
  subject: z.string().max(200).optional().nullable(),
  body: z.string().min(1).max(4000),
  is_active: z.boolean().default(true),
});

export const DeliveryStatus = z.enum([
  "queued",
  "sent",
  "delivered",
  "failed",
  "skipped",
]);

/** A planner-composed outbound message targeting a service's volunteers. */
export const MessageInputSchema = z.object({
  template_id: uuid.optional().nullable(),
  service_id: uuid.optional().nullable(),
  channel: MessageChannel,
  purpose: MessagePurpose.default("custom"),
  /** Rendered/snapshotted subject + body actually sent (audit-friendly). */
  subject: z.string().max(200).optional().nullable(),
  body: z.string().min(1).max(4000),
});

/**
 * One row per (message, recipient). Stores the per-recipient rendered body and
 * the lifecycle status. `skipped` carries a `skip_reason` (e.g. no usable
 * channel). For GDPR we store a hash of the body for audit, not the plaintext.
 */
export const DeliveryInputSchema = z.object({
  message_id: uuid,
  member_id: uuid.optional().nullable(),
  channel: MessageChannel,
  to_recipient: z.string().max(200),
  body_hash: z.string().max(64).optional().nullable(),
  status: DeliveryStatus.default("queued"),
  skip_reason: z.string().max(200).optional().nullable(),
  provider: z.string().max(40).optional().nullable(),
  provider_message_id: z.string().max(200).optional().nullable(),
  cost_cents: z.number().int().min(0).optional().nullable(),
});

// ── OAuth sign-up (Phase 1.3) ──────────────────────────────────────────────────
// Planner onboarding via Supabase's built-in OAuth providers. The pure, network-
// free pieces live here so the client sign-up page AND the server callback route
// share one validated set of providers + the same redirect/error logic, and so
// it's all unit-testable without a Supabase instance. No secrets touch this
// module — provider credentials are configured in Supabase, not in code.

/**
 * The OAuth providers we expose on the sign-up screen. Supabase supports these
 * out of the box; local dev stubs them so the flow is testable without keys.
 * Keep this list in lock-step with the buttons rendered in the sign-up page.
 */
export const OAuthProvider = z.enum(["github", "google", "apple"]);
export type OAuthProviderName = z.infer<typeof OAuthProvider>;

export const OAUTH_PROVIDERS: readonly OAuthProviderName[] = [
  "github",
  "google",
  "apple",
] as const;

/** Human-facing label for each provider button. */
export const OAUTH_PROVIDER_LABELS: Record<OAuthProviderName, string> = {
  github: "GitHub",
  google: "Google",
  apple: "Apple",
};

/**
 * Validate a `?provider=X` query param (from a redirect back to sign-up or from
 * a button click). Returns the canonical provider name or `null` if unknown —
 * the caller decides whether to ignore it or surface an error.
 */
export function parseOAuthProvider(raw: string | null | undefined): OAuthProviderName | null {
  const r = OAuthProvider.safeParse(raw);
  return r.success ? r.data : null;
}

/** Where Supabase sends the browser after the provider authenticates the user. */
export const OAUTH_CALLBACK_PATH = "/auth/callback";

/**
 * Build the absolute `redirectTo` URL handed to `signInWithOAuth`. The provider
 * bounces back to our callback route, which exchanges the code for a session and
 * then forwards to `next` (defaults to `/`, where the app layout decides between
 * onboarding and the dashboard). `next` is sanitised to a same-origin path so an
 * attacker can't smuggle an open-redirect through the query string.
 */
export function buildOAuthRedirectTo(origin: string, next = "/"): string {
  const base = origin.replace(/\/+$/, "");
  const safeNext = sanitizeNextPath(next);
  return `${base}${OAUTH_CALLBACK_PATH}?next=${encodeURIComponent(safeNext)}`;
}

/**
 * Coerce a post-auth `next` target to a safe, same-origin absolute path. Anything
 * that isn't a single leading-slash path (protocol-relative `//evil`, absolute
 * URLs, backslashes) collapses to `/`.
 */
export function sanitizeNextPath(next: string | null | undefined): string {
  if (!next || typeof next !== "string") return "/";
  if (!next.startsWith("/")) return "/";
  if (next.startsWith("//") || next.startsWith("/\\")) return "/";
  return next;
}

/**
 * Map a Supabase / provider OAuth error code (carried as `?error=` or
 * `?error_code=` on the callback) to a short, user-facing message. Unknown codes
 * fall back to a generic line so we never render raw provider jargon.
 */
export function oauthErrorMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  switch (code) {
    case "access_denied":
      return "Sign-up was cancelled. You can try again or use email and password.";
    case "provider_email_needs_verification":
    case "email_not_confirmed":
      return "Your provider account's email isn't verified yet. Verify it, then try again.";
    case "server_error":
    case "temporarily_unavailable":
      return "The sign-in provider is temporarily unavailable. Please try again shortly.";
    default:
      return "We couldn't complete sign-up with that provider. Please try again.";
  }
}

/**
 * A planner account needs a verified email before it can own a church (it's how
 * we reach them for licensing + billing). OAuth identities carry the provider's
 * `email_verified` flag; some providers (e.g. GitHub with a private/unverified
 * email) hand back an unverified address. This guards that mandatory field.
 */
export function isEmailVerifiedIdentity(
  identity: { email?: string | null; email_verified?: boolean | null } | null | undefined,
): boolean {
  if (!identity) return false;
  if (!identity.email) return false;
  return identity.email_verified === true;
}

// ── Reports (Phase 11) ────────────────────────────────────────────────────────

/**
 * Params for a licensing usage report. `from` is inclusive, `to` is exclusive;
 * both are ISO date(-time) strings. Validates the CSV-download query.
 */
export const ReportParamsSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
});

export const ReportKind = z.enum(["tono", "ccli"]);
