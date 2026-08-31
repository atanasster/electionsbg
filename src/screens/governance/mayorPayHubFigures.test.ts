// The /governance/mayor-pay band, against a fixture measured verbatim from the live page
// (read 2026-08-31 at the default view: 259 municipalities, 249 with a resolved income).
//
// Two clauses here are load-bearing beyond the usual "does it build the right cells", and
// both are about things OTHER FILES now depend on:
//
//   • the band is ALL-OR-NOTHING. `scripts/og/capture-screens.ts` waits on a four-cell
//     sibling chain and `COUNTED_WAITS` asserts that count, so a band that could render
//     three would make the capture time out and silently keep the previous card.
//   • `MAYOR_PAY_BAND_CELLS` is what that gate reads. A constant that drifts from the
//     builder is the hand-copied `4` this module was extracted to remove, restored.

import { describe, expect, it } from "vitest";
import {
  MAYOR_PAY_BAND_CELLS,
  mayorPayHubKpis,
  type DominantYear,
} from "./mayorPayHubFigures";

/** Renders the key plus its interpolations, so a basis built from the wrong argument shows
 *  up in the assertion rather than collapsing to a bare key. */
const t = (k: string, o?: Record<string, unknown>) =>
  o ? [k, ...Object.values(o).map(String)].join(":") : k;
const eur = (v: number | null) => (v == null ? "—" : `€${v}`);

const DOMINANT: DominantYear = { fiscalYear: 2025, count: 249 };
const band = (
  total = 259,
  withIncome = 249,
  dominant: DominantYear | null = DOMINANT,
  median: number | null = 35407,
  perThousand: number | null = 3587,
) => mayorPayHubKpis(total, withIncome, dominant, median, perThousand, t, eur);

describe("the band", () => {
  it("carries the four cells the card's capture waits for", () => {
    const cells = band();
    expect(cells).toHaveLength(MAYOR_PAY_BAND_CELLS);
    expect(cells.map((c) => c.value)).toEqual([
      "249/259",
      "2025",
      "€35407",
      "€3587",
    ]);
    expect(cells.map((c) => c.label)).toEqual([
      "mp_kpi_coverage",
      "mp_kpi_dominant_year",
      "mp_kpi_median_income",
      "mp_kpi_median_per_thousand",
    ]);
  });

  it("declares the cell count it actually builds", () => {
    // The whole reason this constant exists — see the module header. A literal that drifted
    // from the builder would leave the og capture waiting for a cell that never renders.
    expect(band()).toHaveLength(MAYOR_PAY_BAND_CELLS);
  });

  it("passes the dominant year its OWN count, not the coverage numerator", () => {
    // ⚠️ THE TWO 249s ARE DIFFERENT PREDICATES and the page has already shipped a bug
    // conflating them (8d378e10b0, „the coverage line claimed 249 filings for a year 2
    // mayors have filed"). Coverage counts a mayor with a labour-income row; this counts a
    // mayor who filed for the dominant year. Fed distinguishable numbers, each cell must
    // carry its own.
    const cells = mayorPayHubKpis(
      259,
      249,
      { fiscalYear: 2025, count: 111 },
      1,
      2,
      t,
      eur,
    );
    expect(cells[0].value).toBe("249/259");
    expect(cells[1].basis).toBe("mp_kpi_dominant_year_detail:111:259");
  });

  it("is all-or-nothing: an empty corpus renders no cells, never a short band", () => {
    // A short band is the state the capture's four-cell chain cannot survive. There must be
    // no input that produces one.
    expect(band(0, 0)).toEqual([]);
    // Every OTHER degenerate input still renders the full band — a missing median is a „—",
    // not a missing cell.
    expect(band(259, 0, null, null, null)).toHaveLength(MAYOR_PAY_BAND_CELLS);
  });

  it("renders a missing figure as an em dash, never as zero", () => {
    // „€0 медианен доход" would be a claim about what mayors are paid; „—" is the absence
    // of one. Same rule the year cell follows when no filing year dominates.
    const cells = band(259, 0, null, null, null);
    expect(cells[1].value).toBe("—");
    expect(cells[2].value).toBe("—");
    expect(cells[3].value).toBe("—");
  });

  it("every cell carries a basis, because none of these four is a salary", () => {
    // The corpus is declared income from employment on the mayor's own filing. A bare
    // „€35 407" beside a name reads as a published pay scale, which is why the module's
    // header makes the basis mandatory rather than decorative.
    for (const cell of band()) {
      expect(cell.basis, `${cell.label} has no basis`).toBeTruthy();
    }
  });
});
