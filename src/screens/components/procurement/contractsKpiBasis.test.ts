// The truth table in `contractsKpiBasis.ts`, executed.
//
// Every clause here corresponds to a sentence the band published on 2026-08-25 and should not
// have. They are asserted over the RULE rather than the screen because the rule is what is
// wrong when they fail — and because the screen would need a mounted DbDataTable and a live
// facets route to reach any of these states.

import { describe, it, expect } from "vitest";
import { contractsKpis, TERM_MAX } from "./contractsKpiBasis";

/** The key IS the string, so an assertion below is about WHICH basis was chosen rather than
 *  about a translation. Interpolation is rendered so `{{term}}` is observable. */
const t = (k: string, o?: Record<string, unknown>) =>
  o && "term" in o ? `${k}:${String(o.term)}` : k;

const base = {
  sumAmountEur: 3_400_000_000,
  count: 13_819,
  singleBidPct: 47,
  directPct: 18,
  cpvActive: false,
  procActive: false,
  singleActive: false,
  gradeActive: false,
  fmtEur: (n: number) => `€${n}`,
  fmtInt: (n: number) => String(n),
  t,
};
type Over = Partial<Parameters<typeof contractsKpis>[0]>;
const run = (over: Over = {}) => contractsKpis({ ...base, ...over });
const labels = (ks: ReturnType<typeof run>) => ks.map((k) => k.label);
const basisOf = (ks: ReturnType<typeof run>, label: string) =>
  ks.find((k) => k.label === label)?.basis;

describe("which cells render", () => {
  it("shows all four when nothing is filtered", () => {
    expect(labels(run())).toEqual([
      "contracts_kpi_total",
      "company_contracts",
      "contracts_stat_single_bid",
      "contracts_stat_direct",
    ]);
  });

  it("withholds the single-bid rate once the reader filters to single-bid rows", () => {
    // The bid facet excludes its own dimension, so this cell would hold at 47% over a table
    // that is 100% single-bidder. Withheld rather than re-captioned: no caption makes „47% са
    // с една оферта" useful to someone who has already asked for only those.
    const ks = run({ singleActive: true });
    expect(labels(ks)).not.toContain("contracts_stat_single_bid");
    expect(labels(ks)).toContain("contracts_stat_direct");
  });

  it("withholds the direct-award rate once the reader filters by procedure", () => {
    // Measured: `?proc=direct` published „18% Пряко възлагане" over rows that are 100% direct.
    const ks = run({ procActive: true });
    expect(labels(ks)).not.toContain("contracts_stat_direct");
    expect(labels(ks)).toContain("contracts_stat_single_bid");
  });

  it("keeps BOTH rates under a CPV filter, which they do follow", () => {
    expect(labels(run({ cpvActive: true }))).toHaveLength(4);
  });

  it("omits a rate with no denominator instead of printing 0%", () => {
    const ks = run({ singleBidPct: null, directPct: null });
    expect(labels(ks)).toEqual(["contracts_kpi_total", "company_contracts"]);
  });

  it("renders NO headline cell until the aggregates arrive", () => {
    // `count == null` is not-loaded. Rendering „€0 · в избрания период" puts a declared basis
    // under a loading state and makes HubHead's `kpisPending` skeleton unreachable.
    const ks = run({ count: undefined, sumAmountEur: undefined });
    expect(labels(ks)).toEqual([
      "contracts_stat_single_bid",
      "contracts_stat_direct",
    ]);
  });

  it("renders a real zero, because 0 contracts is an answer", () => {
    const ks = run({ count: 0, sumAmountEur: 0 });
    expect(labels(ks)).toContain("company_contracts");
    expect(ks.find((k) => k.label === "company_contracts")?.value).toBe("0");
  });
});

describe("what each cell says it is over", () => {
  it("names the period when nothing is filtered or searched", () => {
    const ks = run();
    for (const l of labels(ks))
      expect(basisOf(ks, l)).toBe("contracts_basis_window");
  });

  it("names the filters — never the whole period — when a filter is active", () => {
    // „в целия период" was an affirmative totality claim: with `?cpv=45` the cell reads 35%
    // against a true period-wide 47%.
    const ks = run({ cpvActive: true });
    for (const l of labels(ks))
      expect(basisOf(ks, l)).toBe("contracts_basis_filters");
  });

  it("SPLITS the band when a search is active — the whole point of the step", () => {
    const ks = run({ term: "пътища" });
    // The two that follow the search quote it…
    expect(basisOf(ks, "contracts_kpi_total")).toBe(
      "contracts_basis_matching:пътища",
    );
    expect(basisOf(ks, "company_contracts")).toBe(
      "contracts_basis_matching:пътища",
    );
    // …and the two that cannot say so, rather than sitting silently beside them.
    expect(basisOf(ks, "contracts_stat_single_bid")).toBe(
      "contracts_basis_filters_not_search",
    );
    expect(basisOf(ks, "contracts_stat_direct")).toBe(
      "contracts_basis_filters_not_search",
    );
    // Non-vacuity: the two bases must actually DIFFER, which is the defect in one assertion.
    expect(basisOf(ks, "contracts_kpi_total")).not.toBe(
      basisOf(ks, "contracts_stat_single_bid"),
    );
  });

  it("clamps the echoed term", () => {
    const long = "а".repeat(200);
    const b = basisOf(run({ term: long }), "contracts_kpi_total") ?? "";
    expect(b.length).toBeLessThanOrEqual(
      "contracts_basis_matching:".length + TERM_MAX,
    );
  });

  it("gives every rendered cell a non-empty basis", () => {
    for (const over of [
      {},
      { term: "x" },
      { cpvActive: true },
      { procActive: true },
      { singleActive: true },
      { gradeActive: true },
    ] as const)
      for (const k of run(over))
        expect(
          k.basis.trim(),
          `${k.label} under ${JSON.stringify(over)}`,
        ).not.toBe("");
  });
});
