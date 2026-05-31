/**
 * Phase 7 — canonical ServicePlan exporter (SundayPlan → SundayStage / suite).
 *
 * Pure mapping: turn a SundayPlan {@link Service} + its {@link ServiceItem}s +
 * the setlist into the cross-app canonical `ServicePlan` shape that SundayStage
 * (and the rest of the suite) consumes. No DB, no network, no clock.
 *
 * The canonical shape + the `ServiceItemKind` union here MIRROR
 * `sunday-contracts`; converge once that platform package is published. We can't
 * import `@sunday/*` yet (sunday-platform is not published), so the contract is
 * re-declared locally with this note. Do not add a cross-repo path dependency.
 *
 * Two domain unions feed the canonical `kind`:
 *   - SundayPlan's own per-service {@link ServiceItemKind}
 *     (welcome | song | scripture | sermon | announcement | gap), and
 *   - the template-level {@link TemplateItemKind}
 *     (+ worship_set | response | closing).
 * Both are funnelled through one mapping; anything unrecognized degrades to
 * `"custom"` rather than throwing, so an exporter never loses a line.
 */

import type {
  Service,
  ServiceItem,
  ServiceItemKind,
  TemplateItemKind,
  Song,
  SetlistSong,
} from "@sundayplan/shared";

// ── Canonical contract (mirrors sunday-contracts; converge once published) ─────

/**
 * Canonical service-item kind shared across the Sunday suite. Superset of
 * SundayPlan's local kinds plus the worship/liturgy kinds Stage understands.
 * mirrors sunday-contracts; converge once published.
 */
export type CanonicalServiceItemKind =
  | "welcome"
  | "worship_set"
  | "song"
  | "scripture"
  | "sermon"
  | "response"
  | "closing"
  | "announcement"
  | "gap"
  | "custom";

/**
 * A reference to a song, carrying through both the local SundayPlan song id and
 * (when known) the SundaySong catalog id so Stage can resolve lyrics/chords.
 * mirrors sunday-contracts; converge once published.
 */
export interface CanonicalSongRef {
  /** SundayPlan-local song id. */
  song_id: string;
  /** SundaySong catalog id, when this song is linked to the shared catalog. */
  sundaysong_id: string | null;
  title: string;
  /** CCLI song number, when registered. */
  ccli_song_id: string | null;
  /** TONO work id, when registered. */
  tono_work_id: string | null;
}

/**
 * One line in a canonical service plan.
 * mirrors sunday-contracts; converge once published.
 */
export interface CanonicalServiceItem {
  position: number;
  kind: CanonicalServiceItemKind;
  title: string;
  /** Present only for song items. */
  song_ref: CanonicalSongRef | null;
  /** Present only for scripture items, e.g. "John 3:16". */
  scripture_ref: string | null;
  /** Per-service key override for a song (e.g. transposed), when set. */
  key_override: string | null;
  /** Duration in whole minutes. */
  duration_min: number;
  notes: string | null;
}

/**
 * The canonical, app-agnostic service plan SundayStage consumes.
 * mirrors sunday-contracts; converge once published.
 */
export interface ServicePlan {
  service: {
    id: string;
    church_id: string;
    name: string;
    /** ISO-8601 UTC datetime. */
    starts_at: string;
    state: string;
    was_streamed: boolean;
    notes: string | null;
  };
  items: CanonicalServiceItem[];
}

// ── Kind mapping ───────────────────────────────────────────────────────────────

/**
 * Map a SundayPlan kind (either the per-service {@link ServiceItemKind} or the
 * template-level {@link TemplateItemKind}) onto the canonical kind. Unknown
 * inputs degrade to `"custom"` so an exporter never drops or throws on a line it
 * doesn't recognize. mirrors sunday-contracts; converge once published.
 */
const KIND_MAP: Record<string, CanonicalServiceItemKind> = {
  welcome: "welcome",
  worship_set: "worship_set",
  song: "song",
  scripture: "scripture",
  sermon: "sermon",
  response: "response",
  closing: "closing",
  announcement: "announcement",
  gap: "gap",
};

export function toCanonicalKind(
  kind: ServiceItemKind | TemplateItemKind | string,
): CanonicalServiceItemKind {
  return KIND_MAP[kind] ?? "custom";
}

// ── Exporter ───────────────────────────────────────────────────────────────────

/** A service item paired with the song it references, if any. */
export interface ServiceItemWithSong {
  item: ServiceItem;
  /** The resolved song for this item, when `item.song_id` is set. */
  song?: Song | null;
}

/** A setlist entry paired with its resolved song. */
export interface SetlistEntryWithSong {
  entry: SetlistSong;
  song: Song;
}

export interface ToServicePlanInput {
  service: Service;
  /** Ordered service items (sermon, scripture, gaps, inline songs, …). */
  items: ServiceItemWithSong[];
  /**
   * The setlist songs for this service, when the worship set is kept as a
   * separate setlist rather than inline `song` items. Appended after the
   * service items, continuing the position sequence. Optional.
   */
  setlist?: SetlistEntryWithSong[];
}

function songRef(song: Song): CanonicalSongRef {
  return {
    song_id: song.id,
    sundaysong_id: song.sundaysong_id,
    title: song.title,
    ccli_song_id: song.ccli_song_id,
    tono_work_id: song.tono_work_id,
  };
}

/**
 * Map a SundayPlan service + items + (optional) setlist into the canonical
 * {@link ServicePlan}. Pure and deterministic.
 *
 * - `service.starts_at_utc` → `service.starts_at`; `was_streamed_flag` →
 *   `was_streamed`. (Renamed to the canonical field names.)
 * - Each {@link ServiceItem} maps by `kind`; song items carry a `song_ref`
 *   built from the resolved {@link Song} (including `sundaysong_id`).
 * - Setlist entries are appended as `song` items, their positions continuing
 *   after the highest service-item position so ordering stays stable, with the
 *   per-entry `key_override` threaded through.
 */
export function toServicePlan(input: ToServicePlanInput): ServicePlan {
  const items: CanonicalServiceItem[] = input.items.map(({ item, song }) => {
    const isSong = item.kind === "song" && song != null;
    return {
      position: item.position,
      kind: toCanonicalKind(item.kind),
      title: item.label,
      song_ref: isSong ? songRef(song) : null,
      scripture_ref: item.scripture_ref,
      key_override: null,
      duration_min: item.duration_min,
      notes: item.notes,
    };
  });

  if (input.setlist && input.setlist.length > 0) {
    const maxPosition = items.reduce((m, i) => Math.max(m, i.position), 0);
    let next = maxPosition;
    for (const { entry, song } of input.setlist) {
      next += 1;
      items.push({
        position: next,
        kind: "song",
        title: song.title,
        song_ref: songRef(song),
        scripture_ref: null,
        key_override: entry.key_override,
        duration_min: 0,
        notes: entry.notes,
      });
    }
  }

  return {
    service: {
      id: input.service.id,
      church_id: input.service.church_id,
      name: input.service.name,
      starts_at: input.service.starts_at_utc,
      state: input.service.state,
      was_streamed: input.service.was_streamed_flag,
      notes: input.service.notes,
    },
    items,
  };
}
