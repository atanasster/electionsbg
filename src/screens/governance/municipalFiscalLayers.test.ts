// Gates for the choropleth's palette logic.
//
// A choropleth lies quietly: a wrong colour is still a colour, and no count
// moves. The three properties below are the ones whose failure would be
// invisible on the page.

import { describe, it, expect } from "vitest";
import type { MunicipalFiscalRankingRow } from "@/data/budget/useMunicipalFiscalRanking";
import {
  DEFAULT_LAYER,
  LAYERS,
  cohortStats,
  fillFor,
  intensity,
  layerById,
} from "./municipalFiscalLayers";

const row = (
  over: Partial<MunicipalFiscalRankingRow> = {},
): MunicipalFiscalRankingRow =>
  ({
    obshtina: "X",
    name_bg: "X",
    name_en: null,
    oblast_code: null,
    fiscal_year: 2024,
    quarter: 4,
    commitments_eur: 1,
    commitments_pct: 50,
    expense_obligations_eur: 1,
    obligations_pct: 1,
    arrears_eur: 1,
    arrears_pct: 1,
    cash_on_hand_eur: 1,
    debt_stock_eur: 1,
    meets_threshold: false,
    in_recovery_procedure: false,
    criteria_met: [],
    criteria_evaluable: [2, 3, 4],
    population: 1000,
    commitments_per_capita_eur: 1,
    collection_avg_pct: 76,
    suppressed_fields: null,
    ...over,
  }) as MunicipalFiscalRankingRow;

const COHORT = { max: 100, mean: 76, spread: 10 };

describe("LAYERS", () => {
  it("defaults to the layer that normalises by fiscal capacity", () => {
    // Rule 1: per resident divides by PEOPLE, which is not a measure of
    // capacity, so a small município mid-project reads as reckless purely
    // because its denominator is small. It exists, and it is never the default.
    expect(DEFAULT_LAYER).toBe("commitmentsPct");
    expect(layerById(DEFAULT_LAYER).scale).toEqual({
      kind: "threshold",
      at: 50,
      overIsWorse: true,
    });
    expect(LAYERS.some((l) => l.id === "perCapita")).toBe(true);
  });

  it("makes the unanchored layer carry a caveat", () => {
    // A quantile palette has no fixed meaning, so the only honest version of it
    // names why it is not the default.
    for (const l of LAYERS) {
      if (l.scale.kind === "quantile") {
        expect(l.caveatKey, `${l.id}`).toBeDefined();
      }
    }
  });

  it("falls back to the default for an unknown id rather than crashing", () => {
    expect(layerById("nope" as never).id).toBe(DEFAULT_LAYER);
  });

  it("reads each layer's own field, and null when the município lacks it", () => {
    const l = (id: string) => LAYERS.find((x) => x.id === id)!;
    expect(l("commitmentsPct").value(row({ commitments_pct: 229 }))).toBe(229);
    expect(l("criteria").value(row({ criteria_met: [1, 3] }))).toBe(2);
    // A null `criteria_met` beside a NON-empty `criteria_evaluable` is „we
    // checked three and none fired" — 0, a real finding. Unknown is the
    // separate case where nothing was evaluable at all; see the dedicated
    // block below.
    expect(l("criteria").value(row({ criteria_met: null }))).toBe(0);
    expect(
      l("criteria").value(row({ criteria_met: null, criteria_evaluable: [] })),
    ).toBeNull();
    expect(l("recovery").value(row({ in_recovery_procedure: true }))).toBe(1);
    expect(l("recovery").value(row({ in_recovery_procedure: false }))).toBe(0);
    expect(l("collection").value(row({ collection_avg_pct: null }))).toBeNull();
  });
});

describe("intensity — the threshold layers", () => {
  const commitments = layerById("commitmentsPct");

  it("puts the LEGAL LINE at zero, not at the cohort's midpoint", () => {
    // Rule 2. If the break moved with the cohort, „who is over the line" — the
    // only question the statute asks — would change between two years with
    // identical numbers.
    expect(intensity(commitments, 50, COHORT)).toBe(0);
  });

  it("gives opposite SIGNS either side of the line", () => {
    expect(intensity(commitments, 49, COHORT)!).toBeLessThan(0);
    expect(intensity(commitments, 51, COHORT)!).toBeGreaterThan(0);
  });

  it("is FIXED, so the same number is the same colour in any cohort", () => {
    // Rule 3: a per-year rescale makes every year look identical and destroys
    // the one thing a multi-year map is for.
    const tight = { max: 60, mean: 55, spread: 2 };
    const wide = { max: 900, mean: 200, spread: 300 };
    expect(intensity(commitments, 75, tight)).toBe(
      intensity(commitments, 75, wide),
    );
  });

  it("saturates rather than running away on an extreme value", () => {
    expect(intensity(commitments, 100_000, COHORT)).toBe(1);
    expect(intensity(commitments, 0, COHORT)).toBe(-1);
  });

  it("uses the arrears layer's own 5% line, not the commitments 50%", () => {
    const arrears = layerById("arrearsPct");
    expect(intensity(arrears, 5, COHORT)).toBe(0);
    expect(intensity(arrears, 6, COHORT)!).toBeGreaterThan(0);
    // 6% is over the arrears line but far under the commitments one — the two
    // must not share a scale.
    expect(intensity(commitments, 6, COHORT)!).toBeLessThan(0);
  });
});

describe("intensity — the other scale kinds", () => {
  it("breaks the criteria layer at 3, where the statute does", () => {
    const criteria = layerById("criteria");
    expect(intensity(criteria, 3, COHORT)).toBe(0);
    expect(intensity(criteria, 2, COHORT)!).toBeLessThan(0);
    expect(intensity(criteria, 4, COHORT)!).toBeGreaterThan(0);
    // SEVEN criteria, per МФ's own enumeration — so 7 saturates, not 6.
    expect(intensity(criteria, 7, COHORT)).toBe(1);
    expect(intensity(criteria, 6, COHORT)!).toBeLessThan(1);
  });

  it("renders the binary layer at the two extremes and nothing between", () => {
    const recovery = layerById("recovery");
    expect(intensity(recovery, 1, COHORT)).toBe(1);
    expect(intensity(recovery, 0, COHORT)).toBe(-1);
  });

  it("centres the collection layer on the cohort mean, higher being better", () => {
    const collection = layerById("collection");
    expect(intensity(collection, 76, COHORT)).toBe(0);
    // Above the mean is the COMFORT side for this one — the statute's test is
    // „below the national average".
    expect(intensity(collection, 90, COHORT)!).toBeLessThan(0);
    expect(intensity(collection, 60, COHORT)!).toBeGreaterThan(0);
  });

  it("does not divide by zero on a cohort with no spread", () => {
    const collection = layerById("collection");
    expect(intensity(collection, 76, { max: 76, mean: 76, spread: 0 })).toBe(0);
  });

  it("returns NULL, never 0, for a município that cannot supply the layer", () => {
    // The load-bearing one for the map: 0 is the healthiest colour in the
    // country, so a non-filer coloured 0 is painted as owing nothing.
    for (const l of LAYERS) {
      expect(intensity(l, null, COHORT), `${l.id}`).toBeNull();
    }
  });
});

describe("cohortStats", () => {
  it("ignores nothing and reports max, mean and spread", () => {
    const s = cohortStats([10, 20, 30]);
    expect(s.max).toBe(30);
    expect(s.mean).toBe(20);
    expect(s.spread).toBeCloseTo(Math.sqrt(200 / 3), 6);
  });

  it("survives an empty cohort", () => {
    expect(cohortStats([])).toEqual({ max: 0, mean: 0, spread: 0 });
  });

  it("never returns a zero spread for a real cohort", () => {
    // A single-valued cohort would otherwise divide by zero in the diverging
    // layer.
    expect(cohortStats([5, 5, 5]).spread).toBe(1);
  });
});

describe("fillFor", () => {
  it("gives no-data a fill that is not on either ramp", () => {
    const noData = fillFor(null);
    const values = [-1, -0.5, 0, 0.5, 1].map(fillFor);
    expect(values).not.toContain(noData);
  });

  it("crosses HUES at the break, not merely lightness", () => {
    // A reader who cannot separate two shades of one colour must still see the
    // legal line. Below it is the teal family, above it amber → red.
    const hue = (c: string) => Number(/hsl\((\d+(?:\.\d+)?)/.exec(c)![1]);
    expect(hue(fillFor(-0.5))).toBe(180);
    expect(hue(fillFor(0.5))).toBeLessThan(60);
  });

  it("darkens monotonically with concern", () => {
    const light = (c: string) => Number(/,\s*([\d.]+)%\)$/.exec(c)![1]);
    expect(light(fillFor(1))).toBeLessThan(light(fillFor(0.5)));
    expect(light(fillFor(0.5))).toBeLessThan(light(fillFor(0)));
  });
});

describe("the criteria layer's absent-vs-zero distinction", () => {
  const criteria = layerById("criteria");

  it("is NULL, not 0, when nothing could be evaluated", () => {
    // The critical one. `0 met` is the palest teal — the healthiest fill in the
    // country — and an off-Q4 row, or a Q4 row whose inputs МФ froze, knows
    // nothing at all. The table on the same page renders „—" for these.
    expect(
      criteria.value(row({ criteria_evaluable: [], criteria_met: [] })),
    ).toBeNull();
    expect(
      criteria.value(row({ criteria_evaluable: null, criteria_met: null })),
    ).toBeNull();
  });

  it("is 0 when criteria WERE evaluated and none was met", () => {
    // The other side: „we checked three and none fired" is a real finding and
    // must still colour.
    expect(
      criteria.value(row({ criteria_evaluable: [2, 3, 4], criteria_met: [] })),
    ).toBe(0);
  });

  it("counts the met ones when some fired", () => {
    expect(
      criteria.value(
        row({ criteria_evaluable: [2, 3, 4], criteria_met: [3, 4] }),
      ),
    ).toBe(2);
  });
});

describe("the per-resident layer's log ramp", () => {
  const perCapita = layerById("perCapita");
  // The committed corpus's real shape: median €537 against a €7,607 max.
  const COHORT_REAL = { max: 7607, mean: 900, spread: 800 };

  it("puts the median mid-palette, not at either extreme", () => {
    // Two failures were possible here and both shipped in turn. LINEAR, the
    // median sat at 0.071 — the same colour as the least-committed município in
    // Bulgaria, with 91% of the country inside the first fifth of the ramp.
    // LOG onto [0, 1] then painted almost the whole country red, because
    // `fillFor` reads i >= 0 as the concern ramp. Signed and logged, the median
    // lands in the middle where it belongs.
    const i = intensity(perCapita, 537, COHORT_REAL)!;
    expect(i).toBeGreaterThan(-0.4);
    expect(i).toBeLessThan(0.6);
  });

  it("uses BOTH halves of the palette, having no anchor to divide at", () => {
    // The lowest-committed município must not be amber.
    expect(intensity(perCapita, 1, COHORT_REAL)).toBe(-1);
    expect(intensity(perCapita, 7607, COHORT_REAL)).toBeCloseTo(1, 6);
  });

  it("stays in range at the extremes", () => {
    expect(intensity(perCapita, 0, COHORT_REAL)).toBe(-1);
    expect(intensity(perCapita, 1e9, COHORT_REAL)).toBe(1);
  });

  it("is monotone, so a bigger figure is never a lighter colour", () => {
    let prev = -1;
    for (const v of [1, 10, 100, 537, 1000, 3000, 7607]) {
      const i = intensity(perCapita, v, COHORT_REAL)!;
      expect(i).toBeGreaterThanOrEqual(prev);
      prev = i;
    }
  });

  it("survives an empty cohort", () => {
    expect(intensity(perCapita, 100, { max: 0, mean: 0, spread: 0 })).toBe(0);
  });
});

describe("fillFor — no-data must be unmistakable", () => {
  const rgb = (c: string): [number, number, number] => {
    const [h, sPct, lPct] = /hsl\(([\d.]+),\s*([\d.]+)%,\s*([\d.]+)%\)/
      .exec(c)!
      .slice(1)
      .map(Number);
    const s = sPct / 100;
    const l = lPct / 100;
    const k = (n: number) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n: number) =>
      l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return [f(0) * 255, f(8) * 255, f(4) * 255];
  };

  it("keeps no-data perceptually clear of EVERY value colour", () => {
    // The string-inequality version of this passed while „did not file" was
    // rgb(224,224,224) and „best in the country" was rgb(200,228,228) — a
    // neutral grey beside a barely-tinted one, indistinguishable on a small
    // polygon. Same reader-level outcome as colouring a non-filer zero.
    const nd = rgb(fillFor(null));
    for (const i of [-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1]) {
      const c = rgb(fillFor(i));
      const d = Math.hypot(c[0] - nd[0], c[1] - nd[1], c[2] - nd[2]);
      expect(d, `i=${i} → ${fillFor(i)}`).toBeGreaterThan(60);
    }
  });
});
