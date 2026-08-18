// A bare YYYY-MM-DD from this corpus is a CALENDAR day, not an instant.
//
// `new Date("2026-08-08")` parses as UTC midnight per spec while
// toLocaleDateString renders in the local zone, so the pair silently shifts the
// date by a day for every reader west of Greenwich. Caught on the /prices hero,
// which captioned a headlineDate of 2026-08-08 as "7.08.2026".

import { describe, it, expect } from "vitest";
import { fmtPriceDate } from "./usePrices";

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
