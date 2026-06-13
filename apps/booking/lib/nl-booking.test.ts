import { describe, it, expect } from "vitest";
import {
  foldDiacritics,
  tokenize,
  nameSimilarity,
  fuzzyMatchResource,
  parseClock,
  interpretNorwegianDateTime,
  buildLocalDateTime,
  addMinutesToLocal,
  draftToProposal,
  type MatchableResource,
  type NlBookingDraft,
} from "./nl-booking";

const RESOURCES: MatchableResource[] = [
  { id: "r-stor", name: "Storsalen" },
  { id: "r-lille", name: "Lillesalen" },
  { id: "r-proj", name: "Projektor" },
  { id: "r-kjok", name: "Kjøkken" },
  { id: "r-stoler", name: "Stoler (60 stk)" },
];

const EVENT_TYPES = [
  { id: "et-konf", name: "konfirmasjon", default_duration_min: 90 },
  { id: "et-bryllup", name: "bryllup", default_duration_min: 120 },
  { id: "et-mote", name: "møte", default_duration_min: 60 },
];

describe("foldDiacritics", () => {
  it("lowercases and folds Norwegian diacritics", () => {
    expect(foldDiacritics("Storsalen")).toBe("storsalen");
    expect(foldDiacritics("Kjøkken")).toBe("kjokken");
    expect(foldDiacritics("Dåp")).toBe("dap");
    expect(foldDiacritics("Æra")).toBe("aera");
  });
});

describe("tokenize", () => {
  it("splits on non-alphanumeric and folds", () => {
    expect(tokenize("Stoler (60 stk)")).toEqual(["stoler", "60", "stk"]);
    expect(tokenize("Kjøkken & sal")).toEqual(["kjokken", "sal"]);
  });
});

describe("nameSimilarity", () => {
  it("scores exact folded match as 1", () => {
    expect(nameSimilarity("storsalen", "Storsalen")).toBe(1);
  });
  it("scores a prefix/partial below 1 but high", () => {
    const s = nameSimilarity("storsal", "Storsalen");
    expect(s).toBeGreaterThan(0.5);
    expect(s).toBeLessThanOrEqual(1);
  });
  it("scores unrelated terms low", () => {
    expect(nameSimilarity("traktor", "Storsalen")).toBeLessThan(0.5);
  });
});

describe("fuzzyMatchResource", () => {
  it("matches diacritic-folded resource names", () => {
    const m = fuzzyMatchResource("kjokken", RESOURCES);
    expect(m.resourceId).toBe("r-kjok");
  });
  it("matches a partial term like 'projektor' → Projektor", () => {
    const m = fuzzyMatchResource("projektor", RESOURCES);
    expect(m.resourceId).toBe("r-proj");
    expect(m.score).toBe(1);
  });
  it("returns a null match below threshold", () => {
    const m = fuzzyMatchResource("helikopter", RESOURCES);
    expect(m.resourceId).toBeNull();
    expect(m.resourceName).toBeNull();
  });
});

describe("parseClock", () => {
  it("parses HH:MM, HH.MM and bare hour", () => {
    expect(parseClock("12:30")).toEqual({ hh: 12, mm: 30 });
    expect(parseClock("9.05")).toEqual({ hh: 9, mm: 5 });
    expect(parseClock("18")).toEqual({ hh: 18, mm: 0 });
  });
  it("rejects garbage / out of range", () => {
    expect(parseClock("25:00")).toBeNull();
    expect(parseClock("ab:cd")).toBeNull();
    expect(parseClock(null)).toBeNull();
  });
});

describe("interpretNorwegianDateTime", () => {
  it("resolves an explicit ISO date + time", () => {
    const r = interpretNorwegianDateTime({ date: "2026-05-18", startTime: "12:00" });
    expect(r.start).toBe("2026-05-18T12:00");
    expect(r.hadTime).toBe(true);
  });
  it("defaults to noon when no time given and flags it", () => {
    const r = interpretNorwegianDateTime({ date: "2026-05-18" });
    expect(r.start).toBe("2026-05-18T12:00");
    expect(r.hadTime).toBe(false);
  });
  it("resolves 'i morgen' relative to now", () => {
    const now = new Date(2026, 4, 18, 9, 0, 0); // 18 May 2026 local
    const r = interpretNorwegianDateTime({ relativeDay: "i morgen", startTime: "10:00", now });
    expect(r.start).toBe("2026-05-19T10:00");
  });
  it("resolves the NEXT named weekday (never today)", () => {
    const now = new Date(2026, 4, 18, 9, 0, 0); // Monday 18 May 2026
    const r = interpretNorwegianDateTime({ relativeDay: "mandag", startTime: "12:00", now });
    // next Monday = 25 May
    expect(r.start).toBe("2026-05-25T12:00");
  });
  it("returns null start when nothing resolves", () => {
    const r = interpretNorwegianDateTime({ startTime: "12:00" });
    expect(r.start).toBeNull();
  });
});

describe("buildLocalDateTime / addMinutesToLocal", () => {
  it("pads parts", () => {
    expect(buildLocalDateTime(2026, 5, 3, 9, 5)).toBe("2026-05-03T09:05");
  });
  it("adds minutes across an hour boundary", () => {
    expect(addMinutesToLocal("2026-05-18T12:00", 90)).toBe("2026-05-18T13:30");
  });
});

describe("draftToProposal (canned LLM fixtures, no key)", () => {
  const ctx = { resources: RESOURCES, eventTypes: EVENT_TYPES };

  it("normalizes the canonical prompt → a full proposal", () => {
    // "book storsalen til konfirmasjon 18. mai kl 12, projektor + 60 stoler"
    const draft: NlBookingDraft = {
      title: "Konfirmasjon",
      resources: ["storsalen", "projektor", "stoler"],
      eventType: "konfirmasjon",
      date: "2026-05-18",
      startTime: "12:00",
      capacity: 60,
      extras: ["60 stoler"],
    };
    const p = draftToProposal(draft, ctx);
    expect(p.title).toBe("Konfirmasjon");
    expect(p.eventTypeId).toBe("et-konf");
    expect(p.start).toBe("2026-05-18T12:00");
    // event-type default duration 90 min → ends 13:30
    expect(p.end).toBe("2026-05-18T13:30");
    expect(p.capacity).toBe(60);
    const ids = p.resources.map((r) => r.resourceId);
    expect(ids).toContain("r-stor");
    expect(ids).toContain("r-proj");
    expect(ids).toContain("r-stoler");
    expect(p.unresolved).toHaveLength(0);
  });

  it("uses explicit endTime over duration when valid", () => {
    const draft: NlBookingDraft = {
      resources: ["storsalen"],
      date: "2026-06-01",
      startTime: "10:00",
      endTime: "14:00",
      durationMin: 30,
    };
    const p = draftToProposal(draft, ctx);
    expect(p.start).toBe("2026-06-01T10:00");
    expect(p.end).toBe("2026-06-01T14:00");
  });

  it("falls back to duration when endTime <= start", () => {
    const draft: NlBookingDraft = {
      resources: ["storsalen"],
      date: "2026-06-01",
      startTime: "10:00",
      endTime: "09:00",
      durationMin: 45,
    };
    const p = draftToProposal(draft, ctx);
    expect(p.end).toBe("2026-06-01T10:45");
  });

  it("reports unresolved resources + event type + missing date", () => {
    const draft: NlBookingDraft = {
      resources: ["romskip"],
      eventType: "ufo-landing",
    };
    const p = draftToProposal(draft, ctx);
    expect(p.resources[0].resourceId).toBeNull();
    expect(p.eventTypeId).toBeNull();
    expect(p.unresolved).toContain("resource:romskip");
    expect(p.unresolved).toContain("eventType:ufo-landing");
    expect(p.unresolved).toContain("date");
    expect(p.start).toBeNull();
    expect(p.end).toBeNull();
  });

  it("tolerates a totally mis-shaped draft without throwing", () => {
    const draft = {
      resources: "not-an-array",
      capacity: "sixty",
      extras: [1, 2, { x: 1 }],
      date: 12345,
    } as unknown as NlBookingDraft;
    const p = draftToProposal(draft, ctx);
    expect(p.resources).toEqual([]);
    expect(p.capacity).toBeNull();
    expect(p.extras).toEqual([]);
    expect(p.start).toBeNull();
  });

  it("falls back title to the event-type name when title is absent", () => {
    const draft: NlBookingDraft = {
      resources: ["storsalen"],
      eventType: "bryllup",
      date: "2026-07-04",
      startTime: "14:00",
    };
    const p = draftToProposal(draft, ctx);
    expect(p.title).toBe("bryllup");
    // bryllup default 120 min → ends 16:00
    expect(p.end).toBe("2026-07-04T16:00");
  });
});
