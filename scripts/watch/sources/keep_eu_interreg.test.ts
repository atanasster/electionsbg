import { describe, it, expect } from "vitest";
import { keepEuInterreg, summariseImportDates } from "./keep_eu_interreg";
import { INTERREG_PROGRAMMES } from "../../funds/interreg/programmes";
import type { WatchState } from "../types";

// No network: `fetchImportDate` closes over global fetch, so the pure
// dates → Fingerprint step is extracted and tested here instead.

const dates = (over: Record<string, string | null> = {}) => {
  const d: Record<string, string | null> = {};
  for (const p of INTERREG_PROGRAMMES) d[p.code] = "2026-01-01";
  return { ...d, ...over };
};

const state = (meta: unknown): WatchState =>
  ({ meta }) as unknown as WatchState;

describe("summariseImportDates", () => {
  it("is stable against registry reordering", () => {
    // The curated list's order is editorial. If it leaked into the hash, moving
    // a programme in programmes.ts would report as an upstream change.
    const a = summariseImportDates(dates());
    const shuffled = Object.fromEntries(
      Object.entries(dates()).reverse(),
    ) as Record<string, string | null>;
    expect(summariseImportDates(shuffled).value).toBe(a.value);
  });

  it("changes when any single programme's import date moves", () => {
    const before = summariseImportDates(dates());
    const after = summariseImportDates(
      dates({ [INTERREG_PROGRAMMES[0].code]: "2026-02-02" }),
    );
    expect(after.value).not.toBe(before.value);
  });

  // A programme going dark is a change too — recorded as null rather than
  // dropped, so it cannot shrink the signal silently.
  it("changes when a programme stops publishing a date", () => {
    const before = summariseImportDates(dates());
    const after = summariseImportDates(
      dates({ [INTERREG_PROGRAMMES[0].code]: null }),
    );
    expect(after.value).not.toBe(before.value);
    expect(after.detail).toContain(`${INTERREG_PROGRAMMES.length - 1}/`);
  });

  // The guard against recording a "nothing to see" state built from a keep.eu
  // shape change or a block — which the next run would then compare against.
  it("throws when no programme publishes a date at all", () => {
    const allNull = Object.fromEntries(
      INTERREG_PROGRAMMES.map((p) => [p.code, null]),
    );
    expect(() => summariseImportDates(allNull)).toThrow(/no import date/i);
  });

  it("reports partial coverage honestly", () => {
    // 11 of 22 publish the field today, so the detail line must never imply
    // full coverage.
    const half = dates(
      Object.fromEntries(
        INTERREG_PROGRAMMES.slice(11).map((p) => [p.code, null]),
      ),
    );
    expect(summariseImportDates(half).detail).toContain(
      `11/${INTERREG_PROGRAMMES.length} programmes`,
    );
  });
});

describe("describe()", () => {
  const code = INTERREG_PROGRAMMES[0].code;
  // `describe` is optional on WatchSource; this source declares it, and that is
  // itself worth asserting — without it the report would only ever print the
  // detail line, never which programme moved.
  const describeIt = keepEuInterreg.describe;
  if (!describeIt) throw new Error("keepEuInterreg must declare describe()");

  it("calls a date→date move a re-import", () => {
    const prev = state({ dates: dates() });
    const curr = summariseImportDates(dates({ [code]: "2026-03-03" }));
    const msg = describeIt(prev, curr);
    expect(msg).toContain("re-imported");
    expect(msg).toContain(code);
    expect(msg).toContain("2026-03-03");
  });

  // NOT a re-import, and the distinction costs a ~2 h --full crawl: keep.eu
  // soft-degrading (200 with the field absent) must not read as new data.
  it("does NOT call a programme going dark a re-import", () => {
    const prev = state({ dates: dates() });
    const curr = summariseImportDates(dates({ [code]: null }));
    const msg = describeIt(prev, curr);
    expect(msg).toContain("stopped publishing");
    expect(msg).toContain("NOT a re-import");
    expect(msg).not.toMatch(/programme\(s\) re-imported/);
  });

  it("falls back to the detail line on a first run or no change", () => {
    const fp = summariseImportDates(dates());
    expect(describeIt(null, fp)).toBe(fp.detail);
    expect(describeIt(state({ dates: dates() }), fp)).toBe(fp.detail);
  });
});

// A duplicate code collapses the `dates` map and makes the shadowed
// programme's re-import permanently undetectable — visible only as a detail
// line reading 10/21.
describe("the curated registry the fingerprint keys on", () => {
  it("has unique codes and keep.eu ids", () => {
    const codes = INTERREG_PROGRAMMES.map((p) => p.code);
    expect(new Set(codes).size).toBe(codes.length);
    const ids = INTERREG_PROGRAMMES.map((p) => p.keepProgrammeId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("declares a probe cadence fast enough for its upstream", () => {
    expect(keepEuInterreg.publishes).toBe("monthly");
    expect(keepEuInterreg.cadence).toBe("weekly");
  });
});
