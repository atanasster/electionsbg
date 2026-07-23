// Covers the geometry the matura trend chart draws from: exam-date placement
// (the whole reason the x axis is a date axis and not a category axis), the
// padded score domain, the tick ladder, and the fractional-year round trip the
// cabinet strip's window depends on.

import { describe, it, expect } from "vitest";
import {
  buildMaturaRows,
  cohortMax,
  fromFractionalYear,
  scoreDomain,
  scoreTicks,
  type MaturaYear,
} from "./maturaTrend";
import { dziBelExamDate } from "@/data/schools/maturaCalendar";
import { toFractionalYear } from "@/screens/components/governments/governmentTimelineUtils";

// The live payload, rounded to 2dp exactly as the API serves it.
const NATIONAL: MaturaYear[] = [
  { year: 2022, avg: 3.97, examinees: 43012 },
  { year: 2023, avg: 3.84, examinees: 45866 },
  { year: 2024, avg: 4.3, examinees: 46899 },
  { year: 2025, avg: 4.21, examinees: 48067 },
  { year: 2026, avg: 4.33, examinees: 49014 },
];

describe("dziBelExamDate", () => {
  it("returns the curated МОН date for a known year", () => {
    expect(dziBelExamDate(2024)).toBe("2024-05-17");
    expect(dziBelExamDate(2026)).toBe("2026-05-20");
  });

  it("falls back to the session's modal date for an unseen year", () => {
    expect(dziBelExamDate(2031)).toBe("2031-05-20");
  });
});

describe("buildMaturaRows", () => {
  it("places each point on its exam date, in date order", () => {
    const rows = buildMaturaRows(NATIONAL);
    expect(rows).toHaveLength(5);
    expect(rows.map((r) => r.year)).toEqual([2022, 2023, 2024, 2025, 2026]);
    expect(rows.map((r) => r.date)).toEqual([
      "2022-05-18",
      "2023-05-19",
      "2024-05-17",
      "2025-05-21",
      "2026-05-20",
    ]);
    // Mid-May sits ~38% into the year — the point of the date axis is that it
    // is NOT the middle of the calendar year.
    for (const r of rows) {
      expect(r.t - r.year).toBeGreaterThan(0.35);
      expect(r.t - r.year).toBeLessThan(0.4);
    }
  });

  it("sorts by exam date even when the input is unordered", () => {
    const rows = buildMaturaRows([...NATIONAL].reverse());
    expect(rows.map((r) => r.year)).toEqual([2022, 2023, 2024, 2025, 2026]);
  });

  it("drops years with no score but keeps their neighbours", () => {
    const rows = buildMaturaRows([
      { year: 2022, avg: null, examinees: 0 },
      ...NATIONAL.slice(1),
    ]);
    expect(rows.map((r) => r.year)).toEqual([2023, 2024, 2025, 2026]);
  });

  it("places the 2024 exam inside the Denkov cabinet's tenure", () => {
    // 2024 ran Денков (to 2024-04-09) → Главчев. The exam is 17 May, so it
    // belongs to Главчев — a distinction "the middle of 2024" would lose and
    // "the start of 2024" would get backwards.
    const row = buildMaturaRows(NATIONAL).find((r) => r.year === 2024)!;
    expect(row.date > "2024-04-09").toBe(true);
    expect(row.date < "2024-08-27").toBe(true);
  });
});

describe("scoreDomain", () => {
  it("pads the narrow national band out to tenths", () => {
    expect(scoreDomain(buildMaturaRows(NATIONAL))).toEqual([3.6, 4.5]);
  });

  it("keeps a flat series visible instead of collapsing it to zero height", () => {
    const flat = buildMaturaRows([
      { year: 2025, avg: 4.2, examinees: 10 },
      { year: 2026, avg: 4.2, examinees: 10 },
    ]);
    const [lo, hi] = scoreDomain(flat);
    expect(hi - lo).toBeGreaterThanOrEqual(0.3);
    expect(lo).toBeLessThan(4.2);
    expect(hi).toBeGreaterThan(4.2);
  });
});

describe("scoreTicks", () => {
  it("uses quarter steps inside the domain for a narrow band", () => {
    expect(scoreTicks([3.6, 4.5])).toEqual([3.75, 4, 4.25, 4.5]);
  });

  it("switches to half steps once the span is wide", () => {
    expect(scoreTicks([2, 6])).toEqual([2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6]);
  });

  it("never emits a tick outside the domain", () => {
    for (const [lo, hi] of [
      [3.6, 4.5],
      [3.7, 4.4],
      [2, 6],
    ] as [number, number][]) {
      for (const t of scoreTicks([lo, hi])) {
        expect(t).toBeGreaterThanOrEqual(lo);
        expect(t).toBeLessThanOrEqual(hi);
      }
    }
  });
});

describe("cohortMax", () => {
  it("leaves headroom above the tallest cohort", () => {
    const max = cohortMax(buildMaturaRows(NATIONAL));
    expect(max).toBeGreaterThan(49014);
    expect(max).toBeLessThan(49014 * 1.25);
  });
});

describe("fromFractionalYear", () => {
  it("round-trips a date through the fractional-year scale", () => {
    for (const iso of ["2022-05-18", "2024-05-17", "2026-05-20"]) {
      expect(fromFractionalYear(toFractionalYear(iso))).toBe(iso);
    }
  });

  it("maps the padded domain edges to dates around the exam window", () => {
    const rows = buildMaturaRows(NATIONAL);
    const from = fromFractionalYear(rows[0].t - 0.1);
    const to = fromFractionalYear(rows[rows.length - 1].t + 0.1);
    // ~5 weeks either side, so the first and last dot clear the plot edge.
    expect(from > "2022-04-01" && from < "2022-05-18").toBe(true);
    expect(to > "2026-05-20" && to < "2026-07-01").toBe(true);
  });
});
