// Pins two real bugs a code review found in the inline version of this logic:
// the "община" (name) column sorting opposite to its own ↑/↓ indicator, and
// municipalities with no income on file appearing FIRST on an ascending
// numeric sort — as if "not on file" were the cheapest mayor.

import { describe, it, expect } from "vitest";
import type { MayorPayRankingRow } from "@/data/officials/useMayorPayRanking";
import { applyMayorPayFilter, defaultAscFor } from "./mayorPayFilters";

const row = (over: Partial<MayorPayRankingRow>): MayorPayRankingRow =>
  ({
    obshtina: over.obshtina ?? "X",
    name_bg: "Аврен",
    name_en: null,
    oblast_code: null,
    mayor_name: "Иван Иванов",
    mayor_slug: null,
    declaration_id: null,
    fiscal_year: 2025,
    source_url: null,
    income_eur: null,
    population: null,
    income_per_1000_residents_eur: null,
    ...over,
  }) as MayorPayRankingRow;

const rows: MayorPayRankingRow[] = [
  row({
    obshtina: "A",
    name_bg: "Аврен",
    mayor_name: "Мария Първа",
    income_eur: 10,
    population: 100,
    income_per_1000_residents_eur: 100,
  }),
  row({
    obshtina: "B",
    name_bg: "Балчик",
    mayor_name: "Никола Втори",
    income_eur: 50,
    population: 200,
    income_per_1000_residents_eur: 250,
  }),
  row({
    obshtina: "Y",
    name_bg: "Ямбол",
    mayor_name: "Трети Кмет",
    income_eur: null,
    population: 400,
    income_per_1000_residents_eur: null,
  }),
];

const sofiaRow = row({
  obshtina: "SOF",
  name_bg: "Столична община",
  name_en: "Sofia (capital municipality)",
  mayor_name: "Васил Александров Терзиев",
  income_eur: 79_194,
  population: 1_274_290,
  income_per_1000_residents_eur: 62,
});

describe("defaultAscFor", () => {
  it("name starts ascending (A→Z); every numeric column starts descending (high→low)", () => {
    expect(defaultAscFor("name")).toBe(true);
    expect(defaultAscFor("income")).toBe(false);
    expect(defaultAscFor("population")).toBe(false);
    expect(defaultAscFor("perThousand")).toBe(false);
  });
});

describe("applyMayorPayFilter — municipality name column", () => {
  it("first click (asc=true, matching the header's ↑) sorts A→Z", () => {
    const names = applyMayorPayFilter(rows, "", "name", true).map(
      (r) => r.name_bg,
    );
    expect(names).toEqual(["Аврен", "Балчик", "Ямбол"]);
  });

  it("second click (asc=false, matching the header's ↓) sorts Z→A", () => {
    const names = applyMayorPayFilter(rows, "", "name", false).map(
      (r) => r.name_bg,
    );
    expect(names).toEqual(["Ямбол", "Балчик", "Аврен"]);
  });
});

describe("applyMayorPayFilter — numeric columns never treat missing data as the smallest value", () => {
  it("descending (default): the no-data município (Ямбол) is last", () => {
    const obshtini = applyMayorPayFilter(rows, "", "income", false).map(
      (r) => r.obshtina,
    );
    expect(obshtini).toEqual(["B", "A", "Y"]);
  });

  it("ascending (second click): the no-data município is STILL last, not first", () => {
    const obshtini = applyMayorPayFilter(rows, "", "income", true).map(
      (r) => r.obshtina,
    );
    expect(obshtini).toEqual(["A", "B", "Y"]);
  });

  it("same rule for population and the per-1000 ratio", () => {
    expect(
      applyMayorPayFilter(rows, "", "population", true).map((r) => r.obshtina),
    ).toEqual(["A", "B", "Y"]);
    expect(
      applyMayorPayFilter(rows, "", "perThousand", true).map((r) => r.obshtina),
    ).toEqual(["A", "B", "Y"]);
  });
});

describe("applyMayorPayFilter — search", () => {
  it("matches by municipality name", () => {
    const found = applyMayorPayFilter(rows, "Балчик", "name", true);
    expect(found.map((r) => r.obshtina)).toEqual(["B"]);
  });

  it("matches by mayor name too", () => {
    const found = applyMayorPayFilter(rows, "Втори", "name", true);
    expect(found.map((r) => r.obshtina)).toEqual(["B"]);
  });

  it("folds case and separators, like the sibling screen's search", () => {
    const found = applyMayorPayFilter(rows, "балчик", "name", true);
    expect(found.map((r) => r.obshtina)).toEqual(["B"]);
  });

  it("matches first + family name past the stored patronymic, in either order", () => {
    expect(
      applyMayorPayFilter([...rows, sofiaRow], "Васил Терзиев", "name", true).map(
        (r) => r.obshtina,
      ),
    ).toEqual(["SOF"]);
    expect(
      applyMayorPayFilter([...rows, sofiaRow], "Терзиев Васил", "name", true).map(
        (r) => r.obshtina,
      ),
    ).toEqual(["SOF"]);
  });

  it("normalizes repeated separators and supports Latin-typed names", () => {
    expect(
      applyMayorPayFilter([...rows, sofiaRow], "васил   терзиев", "name", true).map(
        (r) => r.obshtina,
      ),
    ).toEqual(["SOF"]);
    expect(
      applyMayorPayFilter([...rows, sofiaRow], "Vasil Terziev", "name", true).map(
        (r) => r.obshtina,
      ),
    ).toEqual(["SOF"]);
  });

  it("requires every term to match the same row", () => {
    expect(applyMayorPayFilter([...rows, sofiaRow], "Васил Втори", "name", true)).toEqual(
      [],
    );
  });
});
