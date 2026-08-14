// `expenditure` and `expenditureLaw` are two appropriations on two different
// scopes, and picking the wrong one is invisible: both are real figures, both
// render, and the only symptom is a step in a trend that reads as growth.
// See ministrySeries.ts for the МОСВ 2024 case this exists to prevent.

import { describe, it, expect } from "vitest";
import {
  latestCompleteFiscalYear,
  ministryEurSeries,
  ministryYearSeriesEur,
} from "./ministrySeries";

const money = (amountEur: number) => ({ amountEur });

describe("ministryYearSeriesEur", () => {
  it("prefers the ЗДБ figure when the отчет restated the appropriation", () => {
    // МОСВ 2024, the only divergent ministry-year in the tree.
    expect(
      ministryYearSeriesEur({
        expenditure: money(104_230_071),
        expenditureLaw: money(60_325_488),
      }),
    ).toBe(60_325_488);
  });

  it("falls back to `expenditure` on every ordinary year", () => {
    // The overwhelming majority: no отчет, or an отчет whose „Закон" column
    // agrees with the ЗДБ, so the ingest writes no `expenditureLaw` at all.
    expect(ministryYearSeriesEur({ expenditure: money(77_774_100) })).toBe(
      77_774_100,
    );
    expect(
      ministryYearSeriesEur({
        expenditure: money(77_774_100),
        expenditureLaw: null,
      }),
    ).toBe(77_774_100);
  });

  it("returns null when the year carries no appropriation at all", () => {
    expect(ministryYearSeriesEur({})).toBeNull();
    expect(
      ministryYearSeriesEur({ expenditure: null, expenditureLaw: null }),
    ).toBeNull();
  });

  it("does not treat a legitimate zero as missing", () => {
    // `??` rather than `||` — a unit whose law line really is 0 must plot at 0,
    // not fall through to the other scope or disappear from the series.
    expect(
      ministryYearSeriesEur({
        expenditure: money(1_000),
        expenditureLaw: money(0),
      }),
    ).toBe(0);
    expect(ministryYearSeriesEur({ expenditure: money(0) })).toBe(0);
  });

  it("survives a rollup minted before the ingest wrote the field", () => {
    // ministries/*.json is bucket-served, so a file predating 2026-08 has no
    // `expenditureLaw` key — that must read as "no divergence", not as a crash.
    const legacy = JSON.parse(
      '{"fiscalYear":2023,"expenditure":{"amountEur":58632703}}',
    );
    expect(ministryYearSeriesEur(legacy)).toBe(58_632_703);
  });
});

// The МРРБ node as it stood on 2026-08-13 — the case that produced the defect.
// Addressed by year through `yr()`, never by index: adding МРРБ's missing 2019
// (a soft hyphen split it onto another node) must not silently renumber a fixture
// every assertion reads positionally.
const MRRB = [
  { fiscalYear: 2018, eur: 213_906_628 },
  { fiscalYear: 2020, eur: 224_294_698 },
  { fiscalYear: 2021, eur: 465_746_563 },
  { fiscalYear: 2022, eur: 1_298_264_164 },
  { fiscalYear: 2023, eur: 1_434_939_591 },
  { fiscalYear: 2024, eur: 567_582_817 },
  { fiscalYear: 2025, eur: 1_058_603_611 },
  { fiscalYear: 2026, eur: 1_058_603_600 },
];
const yr = (fiscalYear: number) => {
  const row = MRRB.find((y) => y.fiscalYear === fiscalYear);
  if (!row) throw new Error(`fixture has no ${fiscalYear}`);
  return row;
};

describe("latestCompleteFiscalYear", () => {
  it("skips the current year, which has a full budget and a part year of spend", () => {
    // The whole point: in 2026 the newest row IS 2026, and pairing its
    // twelve-month appropriation with 7 months of contracts read as 0.9%
    // against the true 2.4%.
    expect(latestCompleteFiscalYear(MRRB, 2026)).toEqual({
      row: yr(2025),
      complete: true,
    });
  });

  it("advances on 1 January without anyone re-running a pipeline", () => {
    expect(latestCompleteFiscalYear(MRRB, 2027)?.row.fiscalYear).toBe(2026);
    expect(latestCompleteFiscalYear(MRRB, 2025)?.row.fiscalYear).toBe(2024);
  });

  it("ignores a FUTURE year as firmly as the current one", () => {
    // A budget law is enacted before its year begins, so the node can carry a
    // year with no contracts at all — dividing by that is a share of zero.
    expect(latestCompleteFiscalYear(MRRB, 2024)?.row.fiscalYear).toBe(2023);
  });

  it("does not assume the series is sorted", () => {
    // `data.years` arrives in file order; the old code took the last element
    // after its own sort, so a helper that trusts input order would regress
    // silently on a node whose years happen to be written newest-first.
    const shuffled = [yr(2025), yr(2018), yr(2026), yr(2022)];
    expect(latestCompleteFiscalYear(shuffled, 2026)?.row).toBe(yr(2025));
  });

  it("tolerates a hole in the series", () => {
    // МРРБ's own 2019 is missing (a soft hyphen split it onto another node),
    // so "the year before this one" is not a safe way to compute this.
    expect(latestCompleteFiscalYear(MRRB, 2020)?.row.fiscalYear).toBe(2018);
  });

  it("flags the fallback rather than passing an unfinished year off as complete", () => {
    // Better a LABELLED current-year ratio than an empty tile — but the caller
    // captions its basis, so it has to be told which one it got. Without the
    // flag the tile certifies „последната приключила година" over exactly the
    // partial-year figure this helper exists to prevent.
    const young = [{ fiscalYear: 2026, eur: 1 }];
    expect(latestCompleteFiscalYear(young, 2026)).toEqual({
      row: young[0],
      complete: false,
    });
  });

  it("returns null on an empty series", () => {
    expect(latestCompleteFiscalYear([], 2026)).toBeNull();
  });

  it("returns the caller's own row, not a copy", () => {
    // Callers read sibling fields (the € figure) off the returned object.
    const found = latestCompleteFiscalYear(MRRB, 2026);
    expect(found?.row).toBe(yr(2025));
    expect(found?.row.eur).toBe(1_058_603_611);
  });

  it("resolves a duplicate fiscal year to the first row in input order", () => {
    const dupes = [
      { fiscalYear: 2025, eur: 1 },
      { fiscalYear: 2025, eur: 2 },
    ];
    expect(latestCompleteFiscalYear(dupes, 2026)?.row).toBe(dupes[0]);
  });
});

describe("ministryEurSeries", () => {
  it("sorts ascending and drops years with no appropriation", () => {
    expect(
      ministryEurSeries([
        { fiscalYear: 2025, expenditure: money(3) },
        { fiscalYear: 2023, expenditure: null },
        { fiscalYear: 2024, expenditure: money(1) },
      ]),
    ).toEqual([
      { fiscalYear: 2024, eur: 1 },
      { fiscalYear: 2025, eur: 3 },
    ]);
  });

  it("applies the expenditureLaw rule, so the six tiles cannot disagree", () => {
    // МОСВ 2024 again — the collection helper must not reintroduce the отчет
    // figure that ministryYearSeriesEur exists to suppress.
    expect(
      ministryEurSeries([
        {
          fiscalYear: 2024,
          expenditure: money(104_230_071),
          expenditureLaw: money(60_325_488),
        },
      ]),
    ).toEqual([{ fiscalYear: 2024, eur: 60_325_488 }]);
  });

  it("keeps a legitimate zero rather than treating it as missing", () => {
    expect(
      ministryEurSeries([{ fiscalYear: 2024, expenditure: money(0) }]),
    ).toEqual([{ fiscalYear: 2024, eur: 0 }]);
  });

  it("returns [] for an absent rollup instead of throwing", () => {
    // Every call site passes `data?.years` off a React Query hook, so undefined
    // is the FIRST render on every one of them.
    expect(ministryEurSeries(undefined)).toEqual([]);
    expect(ministryEurSeries(null)).toEqual([]);
    expect(ministryEurSeries([])).toEqual([]);
  });

  it("does not mutate the caller's array", () => {
    // `.sort()` is in-place; mapping first is what keeps `data.years` — a React
    // Query cache entry shared by every tile on the page — untouched.
    const years = [
      { fiscalYear: 2026, expenditure: money(2) },
      { fiscalYear: 2024, expenditure: money(1) },
    ];
    ministryEurSeries(years);
    expect(years.map((y) => y.fiscalYear)).toEqual([2026, 2024]);
  });
});
