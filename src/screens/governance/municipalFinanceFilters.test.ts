// Gates for the browse's URL state and row shaping.
//
// Two rules carry the weight, and both are about NULLs. A withheld figure is
// „not published", never zero — so it must never sort as though the município
// had contracted nothing. And an out-of-range URL value must fall back to the
// default rather than through to a predicate, because a table sorted by a
// column that does not exist renders in corpus order and still looks ranked.

import { describe, it, expect } from "vitest";
import {
  applyFilters,
  DEFAULTS,
  foldName,
  parseFilters,
  toParams,
  type MunicipalFinanceFilters,
} from "./municipalFinanceFilters";
import type { MunicipalFiscalRankingRow } from "@/data/budget/useMunicipalFiscalRanking";

const row = (
  name_bg: string,
  over: Partial<MunicipalFiscalRankingRow> = {},
): MunicipalFiscalRankingRow => ({
  obshtina: name_bg,
  name_bg,
  name_en: null,
  oblast_code: "BLG",
  fiscal_year: 2024,
  quarter: 4,
  commitments_eur: 1_000_000,
  commitments_pct: 100,
  expense_obligations_eur: 100_000,
  obligations_pct: 10,
  arrears_eur: 1_000,
  arrears_pct: 1,
  cash_on_hand_eur: 500_000,
  debt_stock_eur: 0,
  meets_threshold: false,
  in_recovery_procedure: false,
  criteria_met: [],
  criteria_evaluable: [1, 2, 3],
  population: 10_000,
  commitments_per_capita_eur: 100,
  suppressed_fields: null,
  ...over,
});

const f = (over: Partial<MunicipalFinanceFilters> = {}) => ({
  ...DEFAULTS,
  ...over,
});

describe("parseFilters", () => {
  it("returns the defaults for an empty query", () => {
    expect(parseFilters(new URLSearchParams())).toEqual(DEFAULTS);
  });

  it("drops an unknown ?sort back to the default", () => {
    // Passing it through would sort by a column that does not exist, which
    // renders in corpus order — indistinguishable from a real ranking.
    expect(parseFilters(new URLSearchParams("sort=bribes")).sort).toBe(
      DEFAULTS.sort,
    );
    expect(parseFilters(new URLSearchParams("sort=arrears")).sort).toBe(
      "arrears",
    );
  });

  it("rejects a ?sort that names an inherited Object property", () => {
    // `hasOwnProperty` rather than `in`: "constructor" and "toString" are on
    // every object, and either would index SORTS to a function.
    expect(parseFilters(new URLSearchParams("sort=constructor")).sort).toBe(
      DEFAULTS.sort,
    );
    expect(parseFilters(new URLSearchParams("sort=toString")).sort).toBe(
      DEFAULTS.sort,
    );
  });

  it("treats ?crit=0 as no filter, not as a predicate matching everything", () => {
    expect(parseFilters(new URLSearchParams("crit=0")).crit).toBeNull();
    expect(parseFilters(new URLSearchParams("crit=3")).crit).toBe(3);
    expect(parseFilters(new URLSearchParams("crit=9")).crit).toBeNull();
    expect(parseFilters(new URLSearchParams("crit=abc")).crit).toBeNull();
    expect(parseFilters(new URLSearchParams("crit=2.5")).crit).toBeNull();
  });

  it("validates ?year to a plausible range", () => {
    expect(parseFilters(new URLSearchParams("year=2024")).year).toBe(2024);
    expect(parseFilters(new URLSearchParams("year=1")).year).toBeNull();
    expect(parseFilters(new URLSearchParams("year=abc")).year).toBeNull();
  });

  it("reads the two booleans only from an explicit 1", () => {
    expect(parseFilters(new URLSearchParams("recovery=1")).recovery).toBe(true);
    expect(parseFilters(new URLSearchParams("recovery=true")).recovery).toBe(
      false,
    );
    expect(parseFilters(new URLSearchParams("asc=1")).asc).toBe(true);
  });
});

describe("toParams", () => {
  it("omits every default so a pristine URL stays clean", () => {
    expect(toParams(f()).toString()).toBe("");
  });

  it("round-trips a fully-specified state", () => {
    const state = f({
      sort: "arrears",
      asc: true,
      q: "бяла",
      crit: 3,
      recovery: true,
      year: 2024,
    });
    expect(parseFilters(toParams(state))).toEqual(state);
  });

  it("preserves unrelated params it was handed", () => {
    // `?elections=` and friends are global state; dropping them here would
    // reset the reader's election on every sort click.
    const out = toParams(
      f({ sort: "debt" }),
      new URLSearchParams("elections=x"),
    );
    expect(out.get("elections")).toBe("x");
    expect(out.get("sort")).toBe("debt");
  });

  it("REMOVES a param when its filter returns to the default", () => {
    const out = toParams(f(), new URLSearchParams("sort=debt&crit=3&q=x"));
    expect(out.get("sort")).toBeNull();
    expect(out.get("crit")).toBeNull();
    expect(out.get("q")).toBeNull();
  });
});

describe("foldName", () => {
  it("folds case, spaces and every dash form", () => {
    expect(foldName("Георги Дамяново")).toBe(foldName("георгидамяново"));
    expect(foldName("Мало-Търново")).toBe(foldName("мало – търново"));
  });
});

describe("applyFilters", () => {
  it("sorts by the chosen column, descending by default", () => {
    const rows = [
      row("A", { arrears_eur: 10 }),
      row("B", { arrears_eur: 30 }),
      row("C", { arrears_eur: 20 }),
    ];
    expect(
      applyFilters(rows, f({ sort: "arrears" })).map((r) => r.name_bg),
    ).toEqual(["B", "C", "A"]);
    expect(
      applyFilters(rows, f({ sort: "arrears", asc: true })).map(
        (r) => r.name_bg,
      ),
    ).toEqual(["A", "C", "B"]);
  });

  it("puts a WITHHELD figure last in BOTH directions", () => {
    // The load-bearing one. Treated as 0 it would head an ascending sort as
    // though the município had contracted nothing — the exact conflation the
    // whole corpus exists to prevent.
    const rows = [
      row("has", { commitments_per_capita_eur: 100 }),
      row("withheld", { commitments_per_capita_eur: null }),
      row("more", { commitments_per_capita_eur: 200 }),
    ];
    expect(applyFilters(rows, f()).map((r) => r.name_bg)).toEqual([
      "more",
      "has",
      "withheld",
    ]);
    expect(applyFilters(rows, f({ asc: true })).map((r) => r.name_bg)).toEqual([
      "has",
      "more",
      "withheld",
    ]);
  });

  it("breaks ties by name so the order is stable for two readers of one URL", () => {
    const rows = [
      row("Ямбол", { arrears_eur: 5 }),
      row("Априлци", { arrears_eur: 5 }),
    ];
    expect(
      applyFilters(rows, f({ sort: "arrears" })).map((r) => r.name_bg),
    ).toEqual(["Априлци", "Ямбол"]);
  });

  it("filters by name, folded", () => {
    const rows = [row("Георги Дамяново"), row("Кресна")];
    expect(applyFilters(rows, f({ q: "георги дамяново" }))).toHaveLength(1);
    expect(applyFilters(rows, f({ q: "КРЕСНА" }))).toHaveLength(1);
    expect(applyFilters(rows, f({ q: "няма" }))).toHaveLength(0);
  });

  it("filters on the recovery procedure, which is the MINISTRY's fact", () => {
    // Never merged with `meets_threshold` — that one is our own derivation.
    const rows = [
      row("in", { in_recovery_procedure: true, meets_threshold: false }),
      row("out", { in_recovery_procedure: false, meets_threshold: true }),
    ];
    expect(
      applyFilters(rows, f({ recovery: true })).map((r) => r.name_bg),
    ).toEqual(["in"]);
  });

  it("filters on the COUNT of met criteria, at least N", () => {
    const rows = [
      row("none", { criteria_met: [] }),
      row("two", { criteria_met: [1, 3] }),
      row("three", { criteria_met: [1, 2, 3] }),
    ];
    expect(applyFilters(rows, f({ crit: 3 })).map((r) => r.name_bg)).toEqual([
      "three",
    ]);
    expect(
      applyFilters(rows, f({ crit: 1 }))
        .map((r) => r.name_bg)
        .sort(),
    ).toEqual(["three", "two"]);
  });

  it("treats a NULL criteria array as zero met, not as a match", () => {
    const rows = [row("unknown", { criteria_met: null })];
    expect(applyFilters(rows, f({ crit: 1 }))).toHaveLength(0);
  });

  it("does not mutate the input array", () => {
    const rows = [row("B", { arrears_eur: 1 }), row("A", { arrears_eur: 2 })];
    const before = rows.map((r) => r.name_bg);
    applyFilters(rows, f({ sort: "arrears" }));
    expect(rows.map((r) => r.name_bg)).toEqual(before);
  });
});
