/**
 * Phase 7 — canonical ServicePlan exporter (SundayPlan → SundayStage / suite).
 *
 * Pure mapping: turn a SundayPlan {@link Service} + its {@link ServiceItem}s +
 * the setlist into the cross-app canonical `ServicePlan` shape that SundayStage
 * (and the rest of the suite) consumes. No DB, no network, no clock.
 *
 * The canonical shapes are now imported DIRECTLY from sunday-platform
 * `@sunday/contracts` (v0.4.1) — `service.ts` (`ServicePlan`, `ServiceRef`,
 * `SetlistItem`, `ServiceItemKind`), `song.ts` (`SongRef`), `mapping.ts`
 * (`serviceItemKindFromPlan`) and `common.ts` (`SCHEMA_VERSION`). This module
 * re-exports them under the historical `Canonical*`/`ServicePlan` names so the
 * SundayPlan callers and tests keep their imports unchanged. There is no longer
 * a local mirror to drift; the contract package is the single source of truth.
 *
 * Two domain unions feed the canonical `kind`:
 *   - SundayPlan's own per-service {@link ServiceItemKind}
 *     (welcome | song | scripture | sermon | announcement | gap), and
 *   - the template-level {@link TemplateItemKind}
 *     (+ worship_set | response | closing).
 * Both are funnelled through one mapping (the canonical `serviceItemKindFromPlan`,
 * re-exported here as {@link toCanonicalKind}): `worship_set` → `song`,
 * `closing` → `custom`, anything unrecognized degrades to `"custom"` rather than
 * throwing, so an exporter never loses a line. Consumers that must also accept
 * payloads from OLDER SundayPlan builds (which put `worship_set`/`closing` on
 * the wire) can use the canonical `serviceItemKindFromWire` normaliser.
 */

import {
  SCHEMA_VERSION as CONTRACT_SCHEMA_VERSION,
  serviceItemKindFromPlan,
  type ServiceItemKind as CanonicalServiceItemKindContract,
  type SongRef,
  type SetlistItem,
  type ServicePlan as CanonicalServicePlan,
} from "@sunday/contracts";
import type {
  Service,
  ServiceItem,
  ServiceItemKind,
  TemplateItemKind,
  Song,
  SetlistSong,
} from "@sundayplan/shared";

// ── Canonical contract (re-exported from @sunday/contracts v0.4.1) ─────────────

/** Wire schema version every canonical payload carries. */
export const SCHEMA_VERSION = CONTRACT_SCHEMA_VERSION;

/**
 * Canonical service-item kind shared across the Sunday suite. The CANONICAL
 * union from `@sunday/contracts` (`ServiceItemKind`) — SundayPlan's local
 * `worship_set`/`closing` are mapped onto it by {@link toCanonicalKind}.
 */
export type CanonicalServiceItemKind = CanonicalServiceItemKindContract;

/**
 * A cross-app reference to a song — the canonical `SongRef` from
 * `@sunday/contracts`. The SundayPlan-local song id rides in `local_id`;
 * `sundaysong_id` is the shared-catalog id when linked.
 */
export type CanonicalSongRef = SongRef;

/**
 * One line in a canonical service plan — the canonical `SetlistItem` from
 * `@sunday/contracts`.
 */
export type CanonicalServiceItem = SetlistItem;

/**
 * The canonical, app-agnostic service plan SundayStage consumes — the canonical
 * `ServicePlan` from `@sunday/contracts` (incl. the `schema_version` envelope on
 * both the plan and the service ref).
 */
export type ServicePlan = CanonicalServicePlan;

// ── Kind mapping ───────────────────────────────────────────────────────────────

/**
 * Map a SundayPlan kind (either the per-service {@link ServiceItemKind} or the
 * template-level {@link TemplateItemKind}) onto the canonical kind. This is the
 * canonical `serviceItemKindFromPlan` from `@sunday/contracts`: `worship_set` →
 * `song` (the canonical union has no worship_set), `closing` → `custom`. Unknown
 * inputs degrade to `"custom"` so an exporter never drops or throws on a line it
 * doesn't recognize. (The canonical helper already guards against inherited
 * Object.prototype keys.)
 */
export function toCanonicalKind(
  kind: ServiceItemKind | TemplateItemKind | string,
): CanonicalServiceItemKind {
  return serviceItemKindFromPlan(kind);
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
    sundaysong_id: song.sundaysong_id,
    local_id: song.id,
    title: song.title,
    ccli_song_id: song.ccli_song_id,
    tono_work_id: song.tono_work_id,
    default_key: song.default_key,
    language: song.language || "und",
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
    schema_version: SCHEMA_VERSION,
    service: {
      schema_version: SCHEMA_VERSION,
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
