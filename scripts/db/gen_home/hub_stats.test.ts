// The generator's two pure helpers — the ones the whole `computedAt` design rests on, and
// the ones with real edge cases. No Postgres, no fixtures on disk.

import { describe, expect, it } from "vitest";
import { deriveMode, lastValid } from "./hub_stats";
// ⚠️ Its own module now — `events/adapters.ts` needed it too, and a second copy is a
// second place to get the `Date.UTC` rollover right.
import { periodToIsoDay } from "./period";

describe("periodToIsoDay", () => {
  it("resolves a quarter to the day it ENDS on", () => {
    // A figure covering 2026-Q2 is current as of the end of June, not the start of April —
    // dating it earlier would understate the artifact's freshness.
    expect(periodToIsoDay("2026-Q1")).toBe("2026-03-31");
    expect(periodToIsoDay("2026-Q2")).toBe("2026-06-30");
    expect(periodToIsoDay("2026-Q3")).toBe("2026-09-30");
    expect(periodToIsoDay("2026-Q4")).toBe("2026-12-31");
  });

  it("resolves a month to its last day, leap years included", () => {
    // The `Date.UTC(y, m, 0)` idiom is "day zero of the NEXT month" — exactly where an
    // off-by-one hides, so both ends of the year and a leap February are pinned.
    expect(periodToIsoDay("2026-01")).toBe("2026-01-31");
    expect(periodToIsoDay("2026-07")).toBe("2026-07-31");
    expect(periodToIsoDay("2026-12")).toBe("2026-12-31");
    expect(periodToIsoDay("2024-02")).toBe("2024-02-29");
    expect(periodToIsoDay("2026-02")).toBe("2026-02-28");
  });

  it("passes an ISO day through", () => {
    expect(periodToIsoDay("2026-04-19")).toBe("2026-04-19");
  });

  it("REFUSES an impossible month rather than rolling it over", () => {
    // ⚠️ The one that matters. `Date.UTC` rolls over, so a `\\d{2}` month turned "2026-13"
    // into "2027-01-31" and "2026-00" into "2025-12-31" — a plausible date fed straight
    // into `computedAt` and the election window. Null puts it through the filter instead.
    expect(periodToIsoDay("2026-13")).toBeNull();
    expect(periodToIsoDay("2026-00")).toBeNull();
    expect(periodToIsoDay("2026-99")).toBeNull();
  });

  it("refuses anything else", () => {
    expect(periodToIsoDay("garbage")).toBeNull();
    expect(periodToIsoDay("2026")).toBeNull();
    expect(periodToIsoDay("2026-Q5")).toBeNull();
    expect(periodToIsoDay("")).toBeNull();
  });

  it("orders correctly across the dialects, which a lexical sort does not", () => {
    // The reason normalisation exists: "2026-Q2" sorts AFTER "2026-07" lexically, because
    // "Q" > "0" — so a raw max over the mixed set picks the older vintage.
    expect("2026-Q2" > "2026-07").toBe(true);
    expect(periodToIsoDay("2026-Q2")! < periodToIsoDay("2026-07")!).toBe(true);
  });
});

describe("deriveMode", () => {
  const AT = "2026-07-31";

  it("is election_recent inside the window, at both edges", () => {
    expect(deriveMode("2026_07_31", AT)).toBe("election_recent"); // 0 days
    expect(deriveMode("2026_07_17", AT)).toBe("election_recent"); // 14 days
  });

  it("is standard outside it", () => {
    expect(deriveMode("2026_07_16", AT)).toBe("standard"); // 15 days
    expect(deriveMode("2026_04_19", AT)).toBe("standard");
  });

  it("is standard for an election in the FUTURE relative to the artifact", () => {
    // A negative age is not "recent" — it means the registry holds a scheduled event this
    // artifact predates, and the mode must not be inferred from arithmetic alone.
    expect(deriveMode("2026_08_15", AT)).toBe("standard");
  });

  it("falls back to standard on missing or unparseable input", () => {
    expect(deriveMode(null, AT)).toBe("standard");
    expect(deriveMode("not_a_date", AT)).toBe("standard");
    // ⚠️ Including a computedAt that is not a day — the shape the first cut produced when it
    // folded a period label ("2026-Q2") straight through. `Date.parse` returns NaN there,
    // and falling back is what stops a NaN comparison quietly deciding the mode.
    expect(deriveMode("2026_07_31", "2026-Q2")).toBe("standard");
  });
});

describe("lastValid", () => {
  it("takes the last row that carries a finite value, not simply the last row", () => {
    // A series whose newest row is a placeholder would otherwise publish it, and a NaN in
    // the artifact renders as a blank cell rather than as a disclosed absence.
    expect(
      lastValid([
        { period: "2026-Q1", value: 1 },
        { period: "2026-Q2", value: Number.NaN },
      ]),
    ).toEqual({ period: "2026-Q1", value: 1 });
  });

  it("returns null when nothing is usable", () => {
    expect(lastValid([])).toBeNull();
    expect(lastValid(undefined)).toBeNull();
    expect(lastValid([{ period: "2026-Q1", value: Number.NaN }])).toBeNull();
    // A row with a value and no period cannot be dated, so it cannot be published.
    expect(lastValid([{ period: "", value: 3 }])).toBeNull();
  });
});
