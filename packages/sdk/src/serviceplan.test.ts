import { describe, expect, it } from "vitest";
import type { Service, ServiceItem, Song, SetlistSong } from "@sundayplan/shared";
import {
  toCanonicalKind,
  toServicePlan,
  type ServiceItemWithSong,
  type SetlistEntryWithSong,
} from "./serviceplan";

// ── Fixtures ───────────────────────────────────────────────────────────────────

const service: Service = {
  id: "svc1",
  church_id: "ch1",
  template_id: null,
  name: "Sunday Morning",
  starts_at_utc: "2026-09-13T09:00:00Z",
  notes: "Communion Sunday",
  state: "published",
  was_streamed_flag: true,
};

const song: Song = {
  id: "song1",
  church_id: "ch1",
  title: "10,000 Reasons",
  author: "Matt Redman",
  ccli_song_id: "6016351",
  tono_work_id: "TONO-42",
  default_key: "G",
  tempo_bpm: 73,
  language: "en",
  themes: ["worship"],
  last_used_at: null,
  sundaysong_id: "ss-999",
  chord_chart_url: null,
  demo_url: null,
};

function item(partial: Partial<ServiceItem>): ServiceItem {
  return {
    id: "i?",
    service_id: "svc1",
    position: 1,
    label: "Item",
    kind: "gap",
    duration_min: 5,
    notes: null,
    song_id: null,
    scripture_ref: null,
    ...partial,
  };
}

// ── Kind mapping ─────────────────────────────────────────────────────────────────

describe("toCanonicalKind", () => {
  it("maps every known Plan kind to its canonical kind", () => {
    expect(toCanonicalKind("welcome")).toBe("welcome");
    // The canonical union has no worship_set/closing — they map per the
    // canonical PLAN_TO_CANONICAL table (sunday-contracts v0.4.0 mapping.ts).
    expect(toCanonicalKind("worship_set")).toBe("song");
    expect(toCanonicalKind("song")).toBe("song");
    expect(toCanonicalKind("scripture")).toBe("scripture");
    expect(toCanonicalKind("sermon")).toBe("sermon");
    expect(toCanonicalKind("response")).toBe("response");
    expect(toCanonicalKind("closing")).toBe("custom");
    expect(toCanonicalKind("announcement")).toBe("announcement");
    expect(toCanonicalKind("gap")).toBe("gap");
  });

  it("degrades an unknown kind to custom instead of throwing", () => {
    expect(toCanonicalKind("offering")).toBe("custom");
    expect(toCanonicalKind("")).toBe("custom");
    expect(toCanonicalKind("WELCOME")).toBe("custom"); // case-sensitive by design
    // Inherited Object.prototype members must not leak through the lookup.
    expect(toCanonicalKind("constructor")).toBe("custom");
    expect(toCanonicalKind("toString")).toBe("custom");
  });
});

// ── Service-level mapping ────────────────────────────────────────────────────────

describe("toServicePlan — service header", () => {
  it("renames Plan fields onto the canonical service shape", () => {
    const plan = toServicePlan({ service, items: [] });
    // Canonical envelope: schema_version on both the plan and the service ref.
    expect(plan.schema_version).toBe(1);
    expect(plan.service).toEqual({
      schema_version: 1,
      id: "svc1",
      church_id: "ch1",
      name: "Sunday Morning",
      starts_at: "2026-09-13T09:00:00Z",
      state: "published",
      was_streamed: true,
      notes: "Communion Sunday",
    });
    expect(plan.items).toEqual([]);
  });
});

// ── Item mapping ─────────────────────────────────────────────────────────────────

describe("toServicePlan — items", () => {
  it("maps a scripture item, threading scripture_ref through", () => {
    const items: ServiceItemWithSong[] = [
      { item: item({ id: "i1", position: 1, label: "Reading", kind: "scripture", scripture_ref: "John 3:16" }) },
    ];
    const plan = toServicePlan({ service, items });
    expect(plan.items[0]).toEqual({
      position: 1,
      kind: "scripture",
      title: "Reading",
      song_ref: null,
      scripture_ref: "John 3:16",
      key_override: null,
      duration_min: 5,
      notes: null,
    });
  });

  it("builds a song_ref (incl. sundaysong_id) for an inline song item", () => {
    const items: ServiceItemWithSong[] = [
      { item: item({ id: "i2", position: 2, label: "Opener", kind: "song", song_id: "song1", duration_min: 4 }), song },
    ];
    const plan = toServicePlan({ service, items });
    expect(plan.items[0].kind).toBe("song");
    expect(plan.items[0].song_ref).toEqual({
      sundaysong_id: "ss-999",
      local_id: "song1",
      title: "10,000 Reasons",
      ccli_song_id: "6016351",
      tono_work_id: "TONO-42",
      default_key: "G",
      language: "en",
    });
    expect(plan.items[0].duration_min).toBe(4);
  });

  it("leaves song_ref null for a song item with no resolved song", () => {
    const items: ServiceItemWithSong[] = [
      { item: item({ id: "i3", position: 1, kind: "song", song_id: "missing" }), song: null },
    ];
    const plan = toServicePlan({ service, items });
    expect(plan.items[0].kind).toBe("song");
    expect(plan.items[0].song_ref).toBeNull();
  });

  it("degrades an unknown item kind to custom", () => {
    const items: ServiceItemWithSong[] = [
      { item: item({ id: "i4", position: 1, label: "Offering", kind: "offering" as never }) },
    ];
    const plan = toServicePlan({ service, items });
    expect(plan.items[0].kind).toBe("custom");
    expect(plan.items[0].title).toBe("Offering");
  });

  it("preserves item order", () => {
    const items: ServiceItemWithSong[] = [
      { item: item({ id: "a", position: 1, kind: "welcome", label: "Welcome" }) },
      { item: item({ id: "b", position: 2, kind: "sermon", label: "Sermon" }) },
      { item: item({ id: "c", position: 3, kind: "gap", label: "Offering gap" }) },
    ];
    const plan = toServicePlan({ service, items });
    expect(plan.items.map((i) => [i.position, i.kind])).toEqual([
      [1, "welcome"],
      [2, "sermon"],
      [3, "gap"],
    ]);
  });
});

// ── Setlist appending ────────────────────────────────────────────────────────────

describe("toServicePlan — setlist", () => {
  function entry(partial: Partial<SetlistSong>, s: Song): SetlistEntryWithSong {
    return {
      entry: {
        setlist_id: "sl1",
        position: 1,
        song_id: s.id,
        key_override: null,
        notes: null,
        ...partial,
      },
      song: s,
    };
  }

  it("appends setlist songs after service items, continuing positions", () => {
    const items: ServiceItemWithSong[] = [
      { item: item({ id: "i1", position: 1, kind: "welcome", label: "Welcome" }) },
      { item: item({ id: "i2", position: 2, kind: "sermon", label: "Sermon" }) },
    ];
    const setlist: SetlistEntryWithSong[] = [
      entry({ position: 1, key_override: "A" }, song),
    ];
    const plan = toServicePlan({ service, items, setlist });
    expect(plan.items).toHaveLength(3);
    const appended = plan.items[2];
    expect(appended.position).toBe(3); // continues after max item position
    expect(appended.kind).toBe("song");
    expect(appended.title).toBe("10,000 Reasons");
    expect(appended.key_override).toBe("A");
    expect(appended.song_ref?.sundaysong_id).toBe("ss-999");
  });

  it("starts setlist positions at 1 when there are no service items", () => {
    const plan = toServicePlan({ service, items: [], setlist: [entry({}, song)] });
    expect(plan.items[0].position).toBe(1);
  });

  it("is a no-op when the setlist is empty or absent", () => {
    expect(toServicePlan({ service, items: [], setlist: [] }).items).toEqual([]);
    expect(toServicePlan({ service, items: [] }).items).toEqual([]);
  });
});
