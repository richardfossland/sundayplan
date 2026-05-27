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
  description: z.string().max(1000).optional().nullable(),
});

export const TeamMembershipInputSchema = z.object({
  member_id: uuid,
  team_id: uuid,
  role_id: uuid,
  skill_level: SkillLevel.default("capable"),
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
  "assignment_response", "availability_set", "swap_request", "generic",
]);

export const MagicLinkIssueSchema = z.object({
  member_id: uuid,
  purpose: MagicLinkPurpose,
  assignment_id: uuid.optional().nullable(),
  /** Time-to-live in seconds — defaults to 7 days */
  ttl_seconds: z.number().int().min(60).max(60 * 60 * 24 * 30).default(60 * 60 * 24 * 7),
});
