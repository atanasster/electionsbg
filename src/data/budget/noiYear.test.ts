// noiYear.ts is the single interpreter of data/budget/noi/funds.json — the
// completeness guard every reader shares, plus the ONE producer of "ДОО
// pensions paid" for /pensions and the /governance/sectors hub tile. It had no
// coverage at all until the pensions sector audit (2026-08-14), which is part
// of why the hub tile spent months publishing the three-fund rollup against a
// page publishing ДОО alone.
//
// Pure functions, no fixtures, no network.

import { describe, it, expect } from "vitest";
import {
  DOO_FUND_CODE,
  dooPensionsEur,
  fundPensionsEur,
  isCompleteNoiYear,
  latestCompleteNoiYear,
  type NoiYearLike,
} from "./noiYear";

/** The real 2024 ДОО pension line, in whole leva. */
const DOO_2024_BGN = 21666698776;
/** What every surface must render for it. */
const DOO_2024_EUR = 11078007176;
/** The three-fund rollup for the same year — the value that must NEVER win. */
const ROLLUP_2024_EUR = 11130510081;

const year = (over: Partial<NoiYearLike> = {}): NoiYearLike => ({
  fiscalYear: 2024,
  funds: [],
  totals: { revenue: { amountEur: 1 } },
  ...over,
});

describe("fundPensionsEur", () => {
  it("rounds identically to the bgnToEur it replaced", () => {
    // Math.round(toEur(bgn, "BGN")) — the live 2024 figure, to the euro.
    expect(
      fundPensionsEur({ fundCode: "5500", pensionsBgn: DOO_2024_BGN }),
    ).toBe(DOO_2024_EUR);
  });

  it("returns null for an absent fund and for a null pension line", () => {
    expect(fundPensionsEur(undefined)).toBeNull();
    expect(fundPensionsEur({ fundCode: "5500", pensionsBgn: null })).toBeNull();
    expect(fundPensionsEur({ fundCode: "5500" })).toBeNull();
  });

  it("distinguishes a real zero from a missing line", () => {
    // ГВРС genuinely pays €0 in pensions; that is a datum, not an absence.
    expect(fundPensionsEur({ fundCode: "5592", pensionsBgn: 0 })).toBe(0);
  });
});

describe("dooPensionsEur", () => {
  it("reads fund 5500 and ignores the other two", () => {
    expect(
      dooPensionsEur({
        funds: [
          { fundCode: "5591", pensionsBgn: 102686756 },
          { fundCode: "5500", pensionsBgn: DOO_2024_BGN },
          { fundCode: "5592", pensionsBgn: 0 },
        ],
      }),
    ).toBe(DOO_2024_EUR);
  });

  it("never returns the three-fund rollup", () => {
    // The regression this module exists to prevent. Summing the funds instead
    // of selecting ДОО gives the rollup, €52,502,905 higher.
    const funds = [
      { fundCode: "5500", pensionsBgn: DOO_2024_BGN },
      { fundCode: "5591", pensionsBgn: 102686756 },
      { fundCode: "5592", pensionsBgn: 0 },
    ];
    expect(dooPensionsEur({ funds })).not.toBe(ROLLUP_2024_EUR);
    expect(ROLLUP_2024_EUR - DOO_2024_EUR).toBe(52502905);
  });

  it("returns null on a shell year (funds: []) and when 5500 is absent", () => {
    expect(dooPensionsEur({ funds: [] })).toBeNull();
    expect(
      dooPensionsEur({ funds: [{ fundCode: "5591", pensionsBgn: 102686756 }] }),
    ).toBeNull();
  });

  it("uses the exported fund code, so the two cannot drift", () => {
    expect(
      dooPensionsEur({
        funds: [{ fundCode: DOO_FUND_CODE, pensionsBgn: DOO_2024_BGN }],
      }),
    ).toBe(DOO_2024_EUR);
  });
});

describe("isCompleteNoiYear", () => {
  it("trusts the stamped flag over the structural test, in both directions", () => {
    // A stamped shell that would otherwise look complete...
    expect(
      isCompleteNoiYear(
        year({
          complete: false,
          funds: [{}],
          totals: { revenue: { amountEur: 9 } },
        }),
      ),
    ).toBe(false);
    // ...and a stamped-complete year whose structure alone would fail.
    expect(
      isCompleteNoiYear(
        year({
          complete: true,
          funds: [],
          totals: { revenue: { amountEur: 0 } },
        }),
      ),
    ).toBe(true);
  });

  it("falls back structurally on a pre-flag artifact", () => {
    // The bucket can transiently serve a funds.json written before `complete`
    // existed, so the structural test must still discriminate.
    expect(
      isCompleteNoiYear(
        year({ funds: [{}], totals: { revenue: { amountEur: 6590528454 } } }),
      ),
    ).toBe(true);
    // The real shell shape: no funds, no revenue.
    expect(
      isCompleteNoiYear(
        year({ funds: [], totals: { revenue: { amountEur: 0 } } }),
      ),
    ).toBe(false);
  });

  it("does not throw on a malformed year", () => {
    // sector_stats.ts runs this at MODULE scope, so a throw would fire at
    // import time — before any preflight could turn it into a skip.
    const malformed = { fiscalYear: 2025 } as unknown as NoiYearLike;
    expect(() => isCompleteNoiYear(malformed)).not.toThrow();
    expect(isCompleteNoiYear(malformed)).toBe(false);
  });
});

describe("latestCompleteNoiYear", () => {
  it("skips shell years rather than taking the highest fiscalYear", () => {
    // The exact 2023/2024 shape at the time of the audit, plus the 2025 shell
    // the ingest publishes mid-cycle — the case that would have flipped the
    // hub headline to a partial figure.
    const years = [
      year({ fiscalYear: 2024, complete: true }),
      year({ fiscalYear: 2023, complete: false }),
      year({ fiscalYear: 2025, complete: false }),
    ];
    expect(latestCompleteNoiYear(years)?.fiscalYear).toBe(2024);
  });

  it("does not trust array order", () => {
    const years = [
      year({ fiscalYear: 2023, complete: true }),
      year({ fiscalYear: 2024, complete: true }),
    ];
    expect(latestCompleteNoiYear(years)?.fiscalYear).toBe(2024);
    expect(latestCompleteNoiYear([...years].reverse())?.fiscalYear).toBe(2024);
  });

  it("returns null when no year qualifies", () => {
    expect(latestCompleteNoiYear([year({ complete: false })])).toBeNull();
    expect(latestCompleteNoiYear([])).toBeNull();
  });
});
