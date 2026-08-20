import { describe, it, expect } from "vitest";
import {
  STALE_DAYS,
  isStale,
  daysBetween,
  beyondCeiling,
} from "./priceStaleness";

describe("isStale", () => {
  it("is false on the latest day and true before it", () => {
    expect(isStale("2026-08-14", "2026-08-14")).toBe(false);
    expect(isStale("2026-08-13", "2026-08-14")).toBe(true);
  });

  it("is false when either side is unknown — never guess staleness", () => {
    expect(isStale(null, "2026-08-14")).toBe(false);
    expect(isStale("2026-08-14", null)).toBe(false);
    expect(isStale(null, null)).toBe(false);
  });

  it("compares ISO dates as strings without parsing", () => {
    // The whole reason the columns are ISO: lexical order is date order, so a
    // month or year rollover cannot be got wrong.
    expect(isStale("2026-07-31", "2026-08-01")).toBe(true);
    expect(isStale("2025-12-31", "2026-01-01")).toBe(true);
  });
});

describe("daysBetween", () => {
  it("counts whole days", () => {
    expect(daysBetween("2026-08-01", "2026-08-14")).toBe(13);
    expect(daysBetween("2026-08-14", "2026-08-14")).toBe(0);
  });

  it("crosses a month boundary without drifting", () => {
    expect(daysBetween("2026-07-31", "2026-08-30")).toBe(30);
    expect(daysBetween("2026-03-01", "2026-03-31")).toBe(30);
    expect(daysBetween("2026-10-01", "2026-10-31")).toBe(30);
  });

  // ⚠️ NOT tested here, deliberately, because it CANNOT be: `daysBetween`
  // rounds, and every DST shift is ±1h, which rounding absorbs. Measured — with
  // the `Z` suffixes removed and TZ=Europe/Sofia (which shifts on 2026-03-29),
  // all ten cases in this file still pass. So the UTC parse is belt-and-braces
  // for readers rather than a behaviour any assertion on this function can pin.
  //
  // Where the parse mode IS observable is in what DAY gets displayed, and that
  // belongs to `parseCalendarDay` / `fmtPriceDate` in usePrices.tsx — pinned by
  // src/lib/dateFormatterPin.test.ts, which is the right home for it. Do not
  // add a test here claiming to cover DST; the last one did and was vacuous.

  it("returns null rather than a number it cannot justify", () => {
    expect(daysBetween(null, "2026-08-14")).toBeNull();
    expect(daysBetween("2026-08-14", null)).toBeNull();
    expect(daysBetween("not-a-date", "2026-08-14")).toBeNull();
  });
});

describe("beyondCeiling", () => {
  it("admits a price exactly at the ceiling and rejects one past it", () => {
    const latest = "2026-08-31";
    const at = "2026-08-01"; // 30 days
    expect(daysBetween(at, latest)).toBe(STALE_DAYS);
    expect(beyondCeiling(at, latest)).toBe(false);
    expect(beyondCeiling("2026-07-31", latest)).toBe(true); // 31 days
  });

  it("does not treat an unknown date as beyond the ceiling", () => {
    // A missing date is "we don't know", which must not silently blank a page.
    expect(beyondCeiling(null, "2026-08-14")).toBe(false);
    expect(beyondCeiling("2026-08-14", null)).toBe(false);
  });

  it("a fresh price is never beyond the ceiling", () => {
    expect(beyondCeiling("2026-08-14", "2026-08-14")).toBe(false);
  });
});
