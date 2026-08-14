// `expenditure` and `expenditureLaw` are two appropriations on two different
// scopes, and picking the wrong one is invisible: both are real figures, both
// render, and the only symptom is a step in a trend that reads as growth.
// See ministrySeries.ts for the МОСВ 2024 case this exists to prevent.

import { describe, it, expect } from "vitest";
import { ministryYearSeriesEur } from "./ministrySeries";

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
