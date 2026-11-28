// The B1 section anchors. Section А is OWN revenue only;
// the state transfer that funds most of НЗОК is section В, and the form's own
// balance is section Г. Reading А − Б as a balance invented a ~€1.8bn deficit
// for 2025 against a real −€26.7M, so all four lines are parsed and pinned.
import { describe, expect, it } from "vitest";
import { assertB1Identity, b1SectionTotals } from "./write_execution";

// Shape of a real B1 Sheet1 row: col 1 = label, col 13 = ОБЩО КАСОВ ОТЧЕТ.
const row = (label: string, total: number | string): unknown[] => {
  const r: unknown[] = new Array(14).fill("");
  r[1] = label;
  r[13] = total;
  return r;
};

// 2025-12 B1 (лв), the figures behind the A3 finding.
const DEC_2025 = [
  row("Показатели", "ОБЩО КАСОВ ОТЧЕТ"),
  row("А. ОБЩО ПРИХОДИ, ПОМОЩИ И ДАРЕНИЯ", 5666984000),
  row("Здравноосигурителни вноски", 5000000000),
  row("Б. ОБЩО РАЗХОДИ И ПРИДОБИВАНЕ НА НЕФИНАНСОВИ АКТИВИ", 9222377000),
  row("В. ОБЩО ТРАНСФЕРИ И ЗАЕМИ М/У БЮДЖЕТНИ ОРГАНИЗАЦИИ (нето)", 3503185000),
  row("Г. Бюджетно салдо   (А-Б+В)", -52208000),
  // A later row that repeats a section's wording must not overwrite it.
  row("Б. ОБЩО РАЗХОДИ — справочно", 1),
];

describe("b1SectionTotals", () => {
  it("reads all four ЕБК sections from the total column", () => {
    expect(b1SectionTotals(DEC_2025)).toEqual({
      revenue: 5666984000,
      expenditure: 9222377000,
      transfers: 3503185000,
      balance: -52208000,
    });
  });

  it("satisfies the form's identity А − Б + В = Г", () => {
    const t = b1SectionTotals(DEC_2025);
    expect(t.revenue! - t.expenditure! + t.transfers! - t.balance!).toBe(0);
  });

  it("is why revenue − expenditure is not the balance", () => {
    const t = b1SectionTotals(DEC_2025);
    // The naive reading is ~70x the real deficit.
    expect(t.revenue! - t.expenditure!).toBeLessThan(50 * t.balance!);
  });

  it("returns null for an absent section rather than 0", () => {
    const t = b1SectionTotals([row("Б. ОБЩО РАЗХОДИ", 10)]);
    expect(t).toEqual({
      revenue: null,
      expenditure: 10,
      transfers: null,
      balance: null,
    });
  });
});

describe("assertB1Identity", () => {
  it("accepts a sheet whose sections satisfy А − Б + В = Г", () => {
    expect(() =>
      assertB1Identity(b1SectionTotals(DEC_2025), "2025-12"),
    ).not.toThrow();
  });

  it("refuses when an anchor picked the wrong row", () => {
    const t = { ...b1SectionTotals(DEC_2025), balance: -3555393000 };
    expect(() => assertB1Identity(t, "2025-12")).toThrow(/А − Б \+ В ≠ Г/);
  });

  it("skips the check when a section is absent", () => {
    const t = { ...b1SectionTotals(DEC_2025), transfers: null };
    expect(() => assertB1Identity(t, "2025-12")).not.toThrow();
  });
});
