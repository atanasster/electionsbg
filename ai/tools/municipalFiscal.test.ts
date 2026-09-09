import { describe, expect, it } from "vitest";
import {
  rankMunicipalFiscalRows,
  type MunicipalFiscalRow,
} from "./municipalFiscal";

const row = (
  obshtina: string,
  commitments: number | null,
  obligations: number | null,
  arrears: number | null,
): MunicipalFiscalRow => ({
  obshtina,
  name_bg: obshtina,
  name_en: null,
  fiscal_year: 2024,
  quarter: 4,
  commitments_eur: commitments,
  expense_obligations_eur: obligations,
  arrears_eur: arrears,
  debt_stock_eur: null,
  meets_threshold: null,
  criteria_evaluable: null,
});

const fixture = [
  row("B", 20, 10, null),
  row("A", 20, 30, 5),
  row("C", null, 20, 40),
];

describe("municipal fiscal ranking", () => {
  it.each([
    ["commitments", ["A", "B", "C"]],
    ["expense_obligations", ["A", "C", "B"]],
    ["arrears", ["C", "A", "B"]],
  ] as const)("orders independently by %s", (metric, expected) => {
    expect(
      rankMunicipalFiscalRows(fixture, metric, 3).map((item) => item.obshtina),
    ).toEqual(expected);
  });

  it.each([1, 100])("accepts the shared count boundary %s", (count) => {
    expect(() =>
      rankMunicipalFiscalRows(fixture, "arrears", count),
    ).not.toThrow();
  });

  it.each([0, 101, 1.5, Number.POSITIVE_INFINITY])(
    "rejects an out-of-contract count %s",
    (count) => {
      expect(() =>
        rankMunicipalFiscalRows(fixture, "arrears", count),
      ).toThrow();
    },
  );
});
