import { expect, it } from "vitest";
import f from "./fixtures/funding-query.json";
// Independent arithmetic: never import production matchers or SQL builders.
it("ISUN separates cost, grant, paid and unknown identity", () => {
  expect(f.isun).toHaveLength(4);
  expect(new Set(f.isun.flatMap((r) => (r.eik ? [r.eik] : []))).size).toBe(2);
  expect(f.isun.filter((r) => r.cost === null)).toHaveLength(1);
  expect(f.isun.reduce((n, r) => n + (r.cost ?? 0), 0)).toBe(300);
  expect(f.isun.reduce((n, r) => n + (r.grant ?? 0), 0)).toBe(230);
  expect(f.isun.reduce((n, r) => n + (r.paid ?? 0), 0)).toBe(190);
  expect(190 / 300).toBeCloseTo(0.6333333333);
  expect(190 / 230).toBeCloseTo(0.8260869565);
  expect(f.isun.every((r) => r.signed === null)).toBe(true);
});
it("DFZ keeps payer exclusions, annual records and negative corrections explicit", () => {
  const rows = f.agri.filter((r) => r.year === 2025 && r.eik !== "121100421");
  expect(rows).toHaveLength(4);
  expect(rows.reduce((n, r) => n + r.amount, 0)).toBe(195);
  const legal = rows.filter((r) => r.eik);
  expect(legal.reduce((n, r) => n + r.amount, 0)).toBe(175);
  expect(new Set(legal.map((r) => r.eik)).size).toBe(2);
  expect(
    f.agri.filter((r) => r.year === 2026).reduce((n, r) => n + r.amount, 0),
  ).toBe(35);
  expect(
    rows.filter((r) => r.scheme === "S1").reduce((n, r) => n + r.amount, 0),
  ).toBe(145);
});
it("Interreg whole-operation and own partner budgets cannot be interchanged", () => {
  const operations = f.operations.filter((r) => r.period === "2021-2027");
  const partners = f.partners.filter(
    (r) =>
      r.country === "Bulgaria" && operations.some((o) => o.id === r.operation),
  );
  expect(operations).toHaveLength(2);
  expect(operations.reduce((n, r) => n + r.budget, 0)).toBe(1500);
  expect(partners).toHaveLength(3);
  expect(partners.filter((r) => r.basis === "unpublished")).toHaveLength(1);
  expect(partners.filter((r) => r.basis === "published_zero")).toHaveLength(1);
  expect(partners.reduce((n, r) => n + (r.budget ?? 0), 0)).toBe(100);
  expect(new Set(partners.map((r) => r.organisation)).size).toBe(2);
});
