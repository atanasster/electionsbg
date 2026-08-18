// A bare YYYY-MM-DD from this corpus is a CALENDAR day, not an instant.
//
// `new Date("2026-08-08")` parses as UTC midnight per spec while
// toLocaleDateString renders in the local zone, so the pair silently shifts the
// date by a day for every reader west of Greenwich. Caught on the /prices hero,
// which captioned a headlineDate of 2026-08-08 as "7.08.2026".

import { describe, it, expect } from "vitest";
import { fmtPriceDate, parseCalendarDay } from "./usePrices";

describe("fmtPriceDate", () => {
  it("renders the calendar day it was given, whatever the local zone", () => {
    // The assertion is zone-independent: whatever TZ the runner is in, the day
    // number must be the one in the string.
    for (const iso of ["2026-08-08", "2026-01-01", "2026-12-31"]) {
      const day = Number(iso.slice(8, 10));
      const out = fmtPriceDate(iso, "bg");
      expect(out).toContain(String(day));
    }
  });

  it("MUTATION CHECK: the naive parse shifts west of Greenwich", () => {
    // Proves the guard is doing work rather than agreeing with the bug. In a
    // zone behind UTC the naive form yields a different day; the fixed one must
    // not. (In a zone at or ahead of UTC both agree, so this asserts only that
    // the fixed form is stable.)
    const naive = new Date("2026-08-08").toLocaleDateString("bg-BG", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    const fixed = fmtPriceDate("2026-08-08", "bg");
    expect(fixed).toContain("8");
    if (new Date("2026-08-08T00:00:00").getTimezoneOffset() > 0)
      expect(fixed).not.toBe(naive);
  });

  it("is empty for a missing date rather than 'Invalid Date'", () => {
    expect(fmtPriceDate(undefined, "bg")).toBe("");
    expect(fmtPriceDate(null, "en")).toBe("");
    expect(fmtPriceDate("", "bg")).toBe("");
  });

  it("still handles a full ISO timestamp", () => {
    expect(fmtPriceDate("2026-08-08T12:00:00Z", "en")).toContain("2026");
  });
});

describe("parseCalendarDay", () => {
  it("is the ONE definition — every prices formatter must route through it", async () => {
    // The regex was hand-copied into PriceIndexTrendChart's tick formatter, and
    // src/ux/feed/calendarDay.test.ts cannot see it: that gate scopes to the
    // `T00:00:00Z` + timeZone:"UTC" idiom, so deleting this copy left every
    // test green. This asserts the copies are gone rather than correct.
    const { readFileSync, readdirSync, statSync } = await import("node:fs");
    const path = await import("node:path");
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((e) => {
        const full = path.join(dir, e);
        return statSync(full).isDirectory()
          ? walk(full)
          : /\.tsx?$/.test(e) && !/\.test\.tsx?$/.test(e)
            ? [full]
            : [];
      });
    const offenders = walk("src/screens/components/prices")
      .concat(walk("src/data/prices"))
      .filter((f) => {
        const src = readFileSync(f, "utf8");
        // the local-parse regex written out inline, anywhere but the helper
        return (
          src.includes("T00:00:00`") &&
          !src.includes("export const parseCalendarDay")
        );
      });
    expect(offenders).toEqual([]);
  });

  it("parses a bare day as local, and passes a full timestamp through", () => {
    const day = parseCalendarDay("2026-08-08");
    expect(day.getDate()).toBe(8);
    expect(day.getHours()).toBe(0);
    // a real instant is not a calendar day and must not be shifted
    expect(parseCalendarDay("2026-08-08T15:30:00Z").toISOString()).toBe(
      "2026-08-08T15:30:00.000Z",
    );
  });
});
