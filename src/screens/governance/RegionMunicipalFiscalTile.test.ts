// Gates for the oblast rollup.
//
// Summing is where the module's two rules are easiest to lose: the stocks nest,
// so they may be added ACROSS municipalities and never across each other; and a
// withheld figure summed as zero publishes a smaller total with nothing saying
// it is smaller.

import { describe, it, expect } from "vitest";
import type { MunicipalFiscalRankingRow } from "@/data/budget/useMunicipalFiscalRanking";
import { resolveCorpusOblast, rollupOblast } from "./oblastFiscalRollup";

const row = (
  obshtina: string,
  oblast_code: string | null,
  over: Partial<MunicipalFiscalRankingRow> = {},
): MunicipalFiscalRankingRow =>
  ({
    obshtina,
    name_bg: obshtina,
    name_en: null,
    oblast_code,
    fiscal_year: 2024,
    quarter: 4,
    commitments_eur: 1_000_000,
    commitments_pct: 40,
    expense_obligations_eur: 100_000,
    obligations_pct: 4,
    arrears_eur: 10_000,
    arrears_pct: 0.4,
    cash_on_hand_eur: 1,
    debt_stock_eur: 1,
    meets_threshold: false,
    in_recovery_procedure: false,
    criteria_met: [],
    criteria_evaluable: [2, 3, 4],
    population: 1000,
    commitments_per_capita_eur: 1000,
    collection_avg_pct: 76,
    suppressed_fields: null,
    ...over,
  }) as MunicipalFiscalRankingRow;

describe("rollupOblast", () => {
  it("sums each stock across the oblast's municipalities", () => {
    const r = rollupOblast(
      [row("A", "BLG"), row("B", "BLG"), row("C", "VAR")],
      "BLG",
    )!;
    expect(r.municipalityCount).toBe(2);
    expect(r.totals.map((tt) => tt.sum)).toEqual([2_000_000, 200_000, 20_000]);
    expect(r.totals.every((tt) => tt.n === 2)).toBe(true);
  });

  it("keeps the three stocks SEPARATE — they nest, so a grand total is nonsense", () => {
    const r = rollupOblast([row("A", "BLG")], "BLG")!;
    expect(r.totals).toHaveLength(3);
    // No field anywhere carries commitments + obligations + arrears.
    expect(Object.values(r)).not.toContain(1_110_000);
  });

  it("EXCLUDES a withheld figure from both the sum and its count", () => {
    // Summed as zero, the total would be smaller with nothing saying so. The
    // count is what makes the undercount legible.
    const r = rollupOblast(
      [row("A", "BLG"), row("B", "BLG", { commitments_eur: null })],
      "BLG",
    )!;
    const commitments = r.totals[0];
    expect(commitments.sum).toBe(1_000_000);
    expect(commitments.n).toBe(1);
    expect(r.municipalityCount).toBe(2);
    expect(r.partial).toBe(true);
  });

  it("is not partial when every município reported every stock", () => {
    expect(
      rollupOblast([row("A", "BLG"), row("B", "BLG")], "BLG")!.partial,
    ).toBe(false);
  });

  it("reports a stock nobody published as zero-count rather than as €0", () => {
    const r = rollupOblast(
      [
        row("A", "BLG", { arrears_eur: null }),
        row("B", "BLG", { arrears_eur: null }),
      ],
      "BLG",
    )!;
    expect(r.totals[2].n).toBe(0);
    expect(r.partial).toBe(true);
  });

  it("counts our criteria derivation and the ministry's status SEPARATELY", () => {
    // Never one „distressed" tally: one is our reading of published levels, the
    // other an administrative fact the município declared. A município can be
    // either without being both.
    const r = rollupOblast(
      [
        row("A", "BLG", {
          criteria_met: [1, 2, 3],
          in_recovery_procedure: false,
        }),
        row("B", "BLG", { criteria_met: [1], in_recovery_procedure: true }),
        row("C", "BLG"),
      ],
      "BLG",
    )!;
    expect(r.criteriaCount).toBe(1);
    expect(r.recoveryCount).toBe(1);
  });

  it("does not count a município at 2 of 6 as meeting the threshold", () => {
    // The statute needs three. Two is not distress and must not be counted.
    const r = rollupOblast([row("A", "BLG", { criteria_met: [1, 2] })], "BLG")!;
    expect(r.criteriaCount).toBe(0);
  });

  it("returns null for an oblast with no municipalities in the corpus", () => {
    expect(rollupOblast([row("A", "BLG")], "VAR")).toBeNull();
    expect(rollupOblast([], "BLG")).toBeNull();
  });

  it("ignores rows with no oblast rather than folding them into every oblast", () => {
    const r = rollupOblast([row("A", "BLG"), row("B", null)], "BLG")!;
    expect(r.municipalityCount).toBe(1);
  });
});

describe("resolveCorpusOblast", () => {
  it("maps all three Sofia МИР to the corpus's single Столична община code", () => {
    // The critical case. Compared raw, `S23`/`S24`/`S25` matched nothing, the
    // rollup came back null, the tile self-suppressed — and an absent tile
    // reads as „this place has nothing to report", not as a bug. The município
    // it dropped is the largest in the country.
    for (const mir of ["S23", "S24", "S25"]) {
      expect(resolveCorpusOblast(mir), mir).toBe("SOFIA_CITY");
    }
  });

  it("returns null for the abroad pseudo-region, which has no municipalities", () => {
    expect(resolveCorpusOblast("32")).toBeNull();
  });

  it("strips a -00 suffix the corpus never carries", () => {
    expect(resolveCorpusOblast("PDV-00")).toBe("PDV");
  });

  it("passes an ordinary oblast through unchanged", () => {
    for (const code of ["BLG", "VAR", "PDV", "SFO"]) {
      expect(resolveCorpusOblast(code), code).toBe(code);
    }
  });

  it("keeps SFO (Sofia-oblast) DISTINCT from SOFIA_CITY", () => {
    // Two different places with confusable names: the ring of municipalities
    // around the capital, and the capital itself.
    expect(resolveCorpusOblast("SFO")).toBe("SFO");
    expect(resolveCorpusOblast("S23")).not.toBe("SFO");
  });
});

describe("rollupOblast — through the route's own vocabulary", () => {
  it("rolls up Sofia when handed a МИР code", () => {
    const r = rollupOblast(
      [row("SOF00", "SOFIA_CITY"), row("A", "BLG")],
      "S23",
    )!;
    expect(r.municipalityCount).toBe(1);
    expect(r.totals[0].sum).toBe(1_000_000);
  });

  it("returns null for the abroad pseudo-region", () => {
    expect(rollupOblast([row("A", "BLG")], "32")).toBeNull();
  });
});
