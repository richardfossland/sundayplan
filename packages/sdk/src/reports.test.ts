import { describe, it, expect } from "vitest";
import {
  filterUsagesByRange,
  buildTonoReport,
  buildCcliReport,
  tonoReportToCsv,
  ccliReportToCsv,
  toCsvRow,
  quarterRange,
  rangeLabel,
} from "./reports";
import type { SongUsageRow } from "@sundayplan/shared";

const usage = (over: Partial<SongUsageRow> = {}): SongUsageRow => ({
  songId: "song-1",
  title: "Amazing Grace",
  tonoWorkId: "T-100",
  ccliNumber: "C-200",
  serviceId: "svc-1",
  serviceDateLocal: "2026-04-05T10:00:00+02:00",
  wasStreamed: false,
  ...over,
});

describe("filterUsagesByRange", () => {
  const rows: SongUsageRow[] = [
    usage({ serviceId: "a", serviceDateLocal: "2026-03-31T10:00:00+02:00" }),
    usage({ serviceId: "b", serviceDateLocal: "2026-04-01T10:00:00+02:00" }),
    usage({ serviceId: "c", serviceDateLocal: "2026-06-30T10:00:00+02:00" }),
    usage({ serviceId: "d", serviceDateLocal: "2026-07-01T00:00:00+02:00" }),
  ];

  it("keeps rows in [from, to) — from inclusive, to exclusive", () => {
    const out = filterUsagesByRange(rows, "2026-04-01", "2026-07-01");
    expect(out.map((r) => r.serviceId)).toEqual(["b", "c"]);
  });

  it("excludes the row exactly at the exclusive upper bound", () => {
    const out = filterUsagesByRange(
      [usage({ serviceId: "x", serviceDateLocal: "2026-07-01T00:00:00+02:00" })],
      "2026-04-01",
      "2026-07-01",
    );
    expect(out).toHaveLength(0);
  });

  it("includes a row exactly at the inclusive lower bound", () => {
    const out = filterUsagesByRange(
      [usage({ serviceId: "x", serviceDateLocal: "2026-04-01T00:00:00+02:00" })],
      "2026-04-01",
      "2026-07-01",
    );
    expect(out).toHaveLength(1);
  });
});

describe("buildTonoReport", () => {
  it("excludes songs without a tono_work_id from lines and flags them as unregistered", () => {
    const rows: SongUsageRow[] = [
      usage({ songId: "s1", tonoWorkId: "T-1", title: "Has TONO" }),
      usage({ songId: "s2", tonoWorkId: null, title: "No TONO" }),
    ];
    const rep = buildTonoReport(rows, "2026-04-01", "2026-07-01");
    expect(rep.lines.map((l) => l.songId)).toEqual(["s1"]);
    expect(rep.unregistered.map((u) => u.songId)).toEqual(["s2"]);
    expect(rep.totals.reportableSongs).toBe(1);
    expect(rep.totals.unregisteredSongs).toBe(1);
  });

  it("aggregates plays per song and splits streamed vs gathered (separate pools)", () => {
    const rows: SongUsageRow[] = [
      usage({ songId: "s1", tonoWorkId: "T-1", serviceId: "v1", wasStreamed: false }),
      usage({ songId: "s1", tonoWorkId: "T-1", serviceId: "v2", wasStreamed: true }),
      usage({ songId: "s1", tonoWorkId: "T-1", serviceId: "v3", wasStreamed: true }),
    ];
    const rep = buildTonoReport(rows, "2026-04-01", "2026-07-01");
    const line = rep.lines[0];
    expect(line.totalPlays).toBe(3);
    expect(line.gatheredPlays).toBe(1);
    expect(line.streamedPlays).toBe(2);
    expect(rep.totals.gatheredPlays).toBe(1);
    expect(rep.totals.streamedPlays).toBe(2);
    expect(rep.totals.totalPlays).toBe(3);
  });

  it("lists distinct service dates sorted ascending", () => {
    const rows: SongUsageRow[] = [
      usage({ songId: "s1", tonoWorkId: "T-1", serviceId: "v2", serviceDateLocal: "2026-05-10T10:00:00+02:00" }),
      usage({ songId: "s1", tonoWorkId: "T-1", serviceId: "v1", serviceDateLocal: "2026-04-05T10:00:00+02:00" }),
      usage({ songId: "s1", tonoWorkId: "T-1", serviceId: "v3", serviceDateLocal: "2026-04-05T18:00:00+02:00" }),
    ];
    const rep = buildTonoReport(rows, "2026-04-01", "2026-07-01");
    expect(rep.lines[0].serviceDates).toEqual(["2026-04-05", "2026-05-10"]);
  });

  it("only includes usages within the date range", () => {
    const rows: SongUsageRow[] = [
      usage({ songId: "s1", tonoWorkId: "T-1", serviceId: "in", serviceDateLocal: "2026-04-05T10:00:00+02:00" }),
      usage({ songId: "s1", tonoWorkId: "T-1", serviceId: "out", serviceDateLocal: "2026-01-05T10:00:00+02:00" }),
    ];
    const rep = buildTonoReport(rows, "2026-04-01", "2026-07-01");
    expect(rep.lines[0].totalPlays).toBe(1);
  });

  it("sorts lines by title", () => {
    const rows: SongUsageRow[] = [
      usage({ songId: "s2", tonoWorkId: "T-2", title: "Zion" }),
      usage({ songId: "s1", tonoWorkId: "T-1", title: "Abide" }),
    ];
    const rep = buildTonoReport(rows, "2026-04-01", "2026-07-01");
    expect(rep.lines.map((l) => l.title)).toEqual(["Abide", "Zion"]);
  });

  it("returns empty report for no rows", () => {
    const rep = buildTonoReport([], "2026-04-01", "2026-07-01");
    expect(rep.lines).toEqual([]);
    expect(rep.unregistered).toEqual([]);
    expect(rep.totals.totalPlays).toBe(0);
  });
});

describe("buildCcliReport", () => {
  it("excludes songs without a ccli_number and flags them as unregistered", () => {
    const rows: SongUsageRow[] = [
      usage({ songId: "s1", ccliNumber: "C-1", title: "Has CCLI" }),
      usage({ songId: "s2", ccliNumber: null, title: "No CCLI" }),
    ];
    const rep = buildCcliReport(rows, "2026-04-01", "2026-07-01");
    expect(rep.lines.map((l) => l.songId)).toEqual(["s1"]);
    expect(rep.unregistered.map((u) => u.songId)).toEqual(["s2"]);
    expect(rep.lines[0].ccliNumber).toBe("C-1");
  });

  it("aggregates play counts and dates (no streaming split — CCLI has no pool concept)", () => {
    const rows: SongUsageRow[] = [
      usage({ songId: "s1", ccliNumber: "C-1", serviceId: "v1", wasStreamed: true, serviceDateLocal: "2026-04-05T10:00:00+02:00" }),
      usage({ songId: "s1", ccliNumber: "C-1", serviceId: "v2", wasStreamed: false, serviceDateLocal: "2026-04-12T10:00:00+02:00" }),
    ];
    const rep = buildCcliReport(rows, "2026-04-01", "2026-07-01");
    expect(rep.lines[0].totalPlays).toBe(2);
    expect(rep.lines[0].serviceDates).toEqual(["2026-04-05", "2026-04-12"]);
    expect(rep.totals.totalPlays).toBe(2);
    expect(rep.totals.reportableSongs).toBe(1);
  });
});

describe("toCsvRow (escaping)", () => {
  it("quotes fields containing commas", () => {
    expect(toCsvRow(["a", "b,c", "d"])).toBe('a,"b,c",d');
  });
  it("escapes embedded double quotes by doubling them", () => {
    expect(toCsvRow(['he said "hi"'])).toBe('"he said ""hi"""');
  });
  it("quotes fields containing newlines", () => {
    expect(toCsvRow(["line1\nline2"])).toBe('"line1\nline2"');
  });
  it("leaves plain fields unquoted", () => {
    expect(toCsvRow(["plain", "123"])).toBe("plain,123");
  });
  it("serializes numbers", () => {
    expect(toCsvRow(["x", 5])).toBe("x,5");
  });
});

describe("tonoReportToCsv", () => {
  it("emits a header and one row per reportable song with the streaming split", () => {
    const rows: SongUsageRow[] = [
      usage({ songId: "s1", tonoWorkId: "T-1", title: "Song, One", serviceId: "v1", wasStreamed: false, serviceDateLocal: "2026-04-05T10:00:00+02:00" }),
      usage({ songId: "s1", tonoWorkId: "T-1", title: "Song, One", serviceId: "v2", wasStreamed: true, serviceDateLocal: "2026-04-12T10:00:00+02:00" }),
    ];
    const rep = buildTonoReport(rows, "2026-04-01", "2026-07-01");
    const csv = tonoReportToCsv(rep);
    const lines = csv.split("\n");
    expect(lines[0]).toBe("title,tono_work_id,total_plays,gathered_plays,streamed_plays,service_dates");
    // title has a comma → must be quoted
    expect(lines[1]).toBe('"Song, One",T-1,2,1,1,2026-04-05 2026-04-12');
  });

  it("does not include unregistered songs in the CSV", () => {
    const rows: SongUsageRow[] = [usage({ tonoWorkId: null })];
    const rep = buildTonoReport(rows, "2026-04-01", "2026-07-01");
    const csv = tonoReportToCsv(rep);
    expect(csv.split("\n")).toHaveLength(1); // header only
  });
});

describe("ccliReportToCsv", () => {
  it("emits a header and one row per reportable song", () => {
    const rows: SongUsageRow[] = [
      usage({ songId: "s1", ccliNumber: "C-1", title: "Plain", serviceId: "v1", serviceDateLocal: "2026-04-05T10:00:00+02:00" }),
    ];
    const rep = buildCcliReport(rows, "2026-04-01", "2026-07-01");
    const csv = ccliReportToCsv(rep);
    const lines = csv.split("\n");
    expect(lines[0]).toBe("title,ccli_number,total_plays,service_dates");
    expect(lines[1]).toBe("Plain,C-1,1,2026-04-05");
  });
});

describe("quarterRange", () => {
  it("Q2 for a May date is Apr 1 (incl) → Jul 1 (excl)", () => {
    expect(quarterRange(new Date("2026-05-30T12:00:00"))).toEqual({
      from: "2026-04-01",
      to: "2026-07-01",
    });
  });
  it("Q1 for a January date", () => {
    expect(quarterRange(new Date("2026-01-15T12:00:00"))).toEqual({
      from: "2026-01-01",
      to: "2026-04-01",
    });
  });
  it("Q4 rolls the upper bound into the next year", () => {
    expect(quarterRange(new Date("2026-11-15T12:00:00"))).toEqual({
      from: "2026-10-01",
      to: "2027-01-01",
    });
  });
});

describe("rangeLabel", () => {
  it("formats a range", () => {
    expect(rangeLabel("2026-04-01", "2026-07-01")).toBe("2026-04-01 → 2026-07-01");
  });
});
