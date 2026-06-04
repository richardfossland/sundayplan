/**
 * Domain types — hand-written, kept in sync with the SQL schema in
 * `packages/db/migrations/`. We don't auto-generate these because
 *   (a) we want hand-controlled discriminated unions for `kind` fields, and
 *   (b) Supabase's generated types are noisier than we need.
 *
 * If the schema changes, update here. The Zod schemas in `./schemas`
 * mirror these shapes and are the runtime validation contract at API
 * boundaries.
 */

// ── Tenancy ─────────────────────────────────────────────────────────────────

export type ChurchPlanTier = "free" | "starter" | "growth" | "network";

export interface Church {
  id: string;
  name: string;
  slug: string;
  plan_tier: ChurchPlanTier;
  locale: string;
  timezone: string;
  denomination: string | null;
  created_at: string;
  updated_at: string;
}

export type TonoStatus =
  | "none"
  | "state_church_blanket"
  | "direct_agreement"
  | "application_pending"
  | "not_applicable";

export type CcliSize = "A" | "B" | "C" | "D" | "E" | "F";

export interface ChurchSettings {
  church_id: string;
  ccli_license_number: string | null;
  ccli_size_category: CcliSize | null;
  ccli_streaming_addon: boolean;
  tono_license_status: TonoStatus;
  tono_customer_id: string | null;
  tono_streaming_addon: boolean;
  default_max_assignments_per_month: number;
  reminder_cadence: { days_before: number[]; hours_before: number[] };
  /** Conflict-engine threshold: warn when a required slot is still unfilled within this many days of the service. */
  unfilled_warn_days: number;
  /** Conflict-engine threshold: warn when a member serves more than this many consecutive Sundays. */
  max_consecutive_sundays: number;
  /** Hard conflict rule: forbid serving again within this many days. 0 = off (default). */
  min_rest_days: number;
  /** Opt-in: mint strict one-shot volunteer response links instead of reusable ones. */
  single_use_response_links: boolean;
  sms_quota_used: number;
  auto_buy_sms_overage: boolean;
  sundaystage_connected: boolean;
  sundayrec_connected: boolean;
  sundaysong_connected: boolean;
}

export type ChurchRole = "admin" | "planner" | "team_lead" | "viewer";

export interface ChurchMember {
  church_id: string;
  user_id: string;
  role: ChurchRole;
  created_at: string;
}

// ── People ──────────────────────────────────────────────────────────────────

export type MemberStatus = "active" | "inactive" | "archived";
export type ContactChannel = "sms" | "email" | "push";

export interface Member {
  id: string;
  church_id: string;
  display_name: string;
  phone_e164: string | null;
  email: string | null;
  user_id: string | null;
  language: string;
  preferred_channel: ContactChannel;
  birthday: string | null; // ISO date
  joined_at: string | null;
  status: MemberStatus;
  notes: string | null;
  tags: string[];
  target_serves_per_month: number | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export type SkillLevel = "training" | "capable" | "lead" | "trainer";

export interface Team {
  id: string;
  church_id: string;
  name: string;
  color: string | null;
  description: string | null;
}

export interface Role {
  id: string;
  team_id: string;
  name: string;
  description: string | null;
}

export interface TeamMembership {
  member_id: string;
  team_id: string;
  role_id: string;
  skill_level: SkillLevel;
  notes: string | null;
}

// ── Availability ────────────────────────────────────────────────────────────

export type AvailabilityKind = "recurring" | "range" | "specific";
export type AvailabilityVisibility = "private" | "planner" | "team";

export interface Availability {
  id: string;
  member_id: string;
  kind: AvailabilityKind;
  pattern:
    | { weekday: string }
    | { from: string; to: string }
    | { dates: string[] }
    | Record<string, unknown>;
  reason: string | null;
  reason_visibility: AvailabilityVisibility;
}

// ── Services ────────────────────────────────────────────────────────────────

export type ServiceItemKind =
  | "welcome"
  | "song"
  | "scripture"
  | "sermon"
  | "announcement"
  | "gap";

export type TemplateItemKind =
  | "welcome"
  | "worship_set"
  | "scripture"
  | "sermon"
  | "response"
  | "closing"
  | "announcement"
  | "gap";

export type ServiceState =
  | "draft"
  | "published"
  | "in_progress"
  | "played"
  | "archived";

export interface ServiceTemplate {
  id: string;
  church_id: string;
  name: string;
  default_duration_min: number;
}

export interface TemplateItem {
  template_id: string;
  position: number;
  label: string;
  kind: TemplateItemKind;
  duration_min: number;
}

export interface ServiceTeamRequirement {
  template_id: string;
  role_id: string;
  quantity: number;
}

export interface Service {
  id: string;
  church_id: string;
  template_id: string | null;
  name: string;
  starts_at_utc: string;
  notes: string | null;
  state: ServiceState;
  was_streamed_flag: boolean;
}

export interface ServiceItem {
  id: string;
  service_id: string;
  position: number;
  label: string;
  kind: ServiceItemKind;
  duration_min: number;
  notes: string | null;
  song_id: string | null;
  scripture_ref: string | null;
}

// ── Songs ───────────────────────────────────────────────────────────────────

export interface Song {
  id: string;
  church_id: string;
  title: string;
  author: string | null;
  ccli_song_id: string | null;
  tono_work_id: string | null;
  default_key: string | null;
  tempo_bpm: number | null;
  language: string;
  themes: string[];
  last_used_at: string | null;
  sundaysong_id: string | null;
  chord_chart_url: string | null;
  demo_url: string | null;
}

export interface Setlist {
  id: string;
  service_id: string;
}

export interface SetlistSong {
  setlist_id: string;
  position: number;
  song_id: string;
  key_override: string | null;
  notes: string | null;
}

// ── Assignments ─────────────────────────────────────────────────────────────

export type AssignmentStatus =
  | "pending"
  | "invited"
  | "accepted"
  | "declined"
  | "no_response"
  | "removed";

export type AssignmentSource = "planner" | "auto_fill" | "swap";

export interface Assignment {
  id: string;
  church_id: string;
  service_id: string;
  role_id: string;
  member_id: string;
  service_item_id: string | null;
  status: AssignmentStatus;
  score: number | null;
  score_breakdown: ScoreBreakdown | null;
  invited_at: string | null;
  responded_at: string | null;
  response_note: string | null;
  next_reminder_at: string | null;
  created_by: AssignmentSource;
}

export interface ScoreBreakdown {
  total: number;
  components: ScoreComponent[];
  warnings: string[];
}

export interface ScoreComponent {
  name:
    | "availability"
    | "skill_match"
    | "rotation_fairness"
    | "frequency_balance"
    | "burnout"
    | "pairing"
    | "variety"
    | "custom";
  weight: number;
  raw: number;
  contribution: number;
  explanation: string;
}

// ── Magic-link auth ─────────────────────────────────────────────────────────

export type MagicLinkPurpose =
  | "assignment_response"
  | "availability_set"
  | "swap_request"
  | "generic"
  | "church_invite";

export interface MagicLinkClaims {
  /** member id — scopes RLS reads */
  sub: string;
  member_id: string;
  church_id: string;
  purpose: MagicLinkPurpose;
  assignment_id?: string;
  /** unix seconds */
  exp: number;
  /** unix seconds */
  iat: number;
  /** prevent reuse */
  jti: string;
}

/** The church_member roles grantable through an invite link. */
export type ChurchInviteRole = "admin" | "planner" | "team_lead";

/**
 * Claims for a church-invite token (Phase 1.3). Unlike {@link MagicLinkClaims}
 * these carry no `member_id` — the invitee has no `member` row; they become a
 * planner-side `church_member` with `role`. `purpose` is always `church_invite`.
 */
export interface ChurchInviteClaims {
  church_id: string;
  role: ChurchInviteRole;
  purpose: "church_invite";
  /** unix seconds */
  exp: number;
  /** unix seconds */
  iat: number;
  /** prevent reuse */
  jti: string;
}

// ── Comms ───────────────────────────────────────────────────────────────────

export type SmsStatus =
  | "queued" | "sent" | "delivered" | "failed" | "bounced";

export interface SmsLog {
  id: string;
  church_id: string;
  member_id: string | null;
  provider: string;
  template_id: string | null;
  to_recipient: string;
  body_hash: string | null;
  status: SmsStatus;
  cost_cents: number | null;
  provider_message_id: string | null;
  sent_at: string | null;
  created_at: string;
}

// ── Communications (Phase 6) ──────────────────────────────────────────────────
// The comms domain: planner-authored templates, outbound messages built from
// them, and per-recipient delivery records. The SDK comms engine renders +
// resolves these; the provider layer transmits them (stubbed by default). The
// `SmsLog` above predates this and is kept for the legacy SMS path; new code
// uses `MessageDelivery`.

export type MessageChannel = "sms" | "email" | "push";

export type MessagePurpose =
  | "invite"
  | "reminder"
  | "final_reminder"
  | "confirmation"
  | "cancellation"
  | "custom";

export type TemplateVariable =
  | "volunteer_name"
  | "role_name"
  | "team_name"
  | "service_title"
  | "service_date"
  | "service_time"
  | "church_name"
  | "accept_link"
  | "decline_link";

export interface MessageTemplate {
  id: string;
  church_id: string;
  name: string;
  channel: MessageChannel;
  purpose: MessagePurpose;
  language: string;
  /** null for sms; subject for email; title for push */
  subject: string | null;
  body: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  church_id: string;
  template_id: string | null;
  service_id: string | null;
  channel: MessageChannel;
  purpose: MessagePurpose;
  subject: string | null;
  body: string;
  created_by: string | null;
  created_at: string;
}

export type DeliveryStatus =
  | "queued"
  | "sent"
  | "delivered"
  | "failed"
  | "skipped";

export interface MessageDelivery {
  id: string;
  message_id: string;
  church_id: string;
  member_id: string | null;
  channel: MessageChannel;
  to_recipient: string;
  /** hashed for GDPR; the plaintext lives only transiently */
  body_hash: string | null;
  status: DeliveryStatus;
  skip_reason: string | null;
  provider: string | null;
  provider_message_id: string | null;
  cost_cents: number | null;
  sent_at: string | null;
  created_at: string;
}

// ── Reports (Phase 11 — TONO + CCLI licensing usage) ──────────────────────────
// The reporting domain turns played-service song usage into the two licensing
// reports Norwegian churches must file: TONO (work id, streaming separate) and
// CCLI (song number). The data layer produces `SongUsageRow`s; the SDK report
// engine groups, splits streamed-vs-gathered, and serializes them. All pure.

/**
 * One normalized "a song was used in a played service" row — the input to the
 * report engine. The data layer derives these from `service_item.song_id`
 * and/or `setlist_song`, joined to the played service. Pure data, no DB types.
 */
export interface SongUsageRow {
  songId: string;
  title: string;
  /** TONO work id, or null when the song is not registered with TONO. */
  tonoWorkId: string | null;
  /** CCLI song number (`song.ccli_song_id`), or null when unregistered. */
  ccliNumber: string | null;
  serviceId: string;
  /** Service start (ISO datetime string) — the date the song was used. */
  serviceDateLocal: string;
  /** True when the service was streamed — TONO's separate royalty pool. */
  wasStreamed: boolean;
}

/** Per-song breakdown line in a TONO usage report. */
export interface TonoReportLine {
  songId: string;
  title: string;
  tonoWorkId: string;
  /** Total times played in range (gathered + streamed). */
  totalPlays: number;
  /** Plays in in-gathering services (was_streamed = false). */
  gatheredPlays: number;
  /** Plays in streamed services — TONO's separate streaming royalty pool. */
  streamedPlays: number;
  /** Distinct service dates (YYYY-MM-DD, ascending) the song was used. */
  serviceDates: string[];
}

/** A song that was played but cannot be reported (no licensing id). */
export interface UnregisteredSongLine {
  songId: string;
  title: string;
  totalPlays: number;
}

export interface TonoReport {
  from: string;
  to: string;
  lines: TonoReportLine[];
  /** Played songs with no tono_work_id — flagged, never silently dropped. */
  unregistered: UnregisteredSongLine[];
  totals: {
    totalPlays: number;
    gatheredPlays: number;
    streamedPlays: number;
    reportableSongs: number;
    unregisteredSongs: number;
  };
}

/** Per-song breakdown line in a CCLI usage report. */
export interface CcliReportLine {
  songId: string;
  title: string;
  ccliNumber: string;
  totalPlays: number;
  serviceDates: string[];
}

export interface CcliReport {
  from: string;
  to: string;
  lines: CcliReportLine[];
  /** Played songs with no ccli number — flagged, never silently dropped. */
  unregistered: UnregisteredSongLine[];
  totals: {
    totalPlays: number;
    reportableSongs: number;
    unregisteredSongs: number;
  };
}
