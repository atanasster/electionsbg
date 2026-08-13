// Parser gates. Built on a synthetic sheet rather than the real workbook: the
// .xlsx is gitignored, so a fixture-driven test is the only one that can run in
// CI or on a fresh clone.
//
// The column numbers below are 1-based to match the module and the README's
// column map; the fixture builder converts.

import { describe, it, expect } from "vitest";
import {
  currencyForYear,
  deriveAvg4y,
  parsePokazateli,
  parseRecoverySheet,
  parsePeriodLabel,
  ratioBasisFor,
  readPeriods,
} from "./parse";

/** Build a 65-wide row with values at 1-based columns. */
const row = (cells: Record<number, unknown>): unknown[] => {
  const r: unknown[] = new Array(65).fill(null);
  for (const [col, v] of Object.entries(cells)) r[Number(col) - 1] = v;
  return r;
};

/** Header row 2: the same three periods repeated across every 3-wide group,
 *  plus the single collection columns on the year-end period. */
const headerRow = (labels: [string, string, string]): unknown[] => {
  const r: unknown[] = new Array(65).fill(null);
  for (let c = 3; c <= 62; c += 3) {
    r[c - 1] = labels[0];
    r[c] = labels[1];
    r[c + 1] = labels[2];
  }
  for (let c = 63; c <= 65; c++) r[c - 1] = labels[1];
  return r;
};

const CROSSWALK = new Map([
  [5101, "BLG01"],
  [7200, "SOF00"],
]);

/** Row 1 carries the group titles. They are load-bearing twice over: the
 *  parser RESOLVES the column map from them (МФ has shipped four layouts), and
 *  their trailing unit label is what it reads for the currency. One label per
 *  group governs its three period columns — the unit is a property of the
 *  GROUP, not of the period.
 *
 *  These are the real 2024-era titles at the real 2024-era offsets, so the
 *  fixture exercises the resolver rather than bypassing it. */
const GROUP_TITLE: Record<number, string> = {
  3: "1. Дял на приходите от общите постъпления",
  6: "2. Покритие на разходите за местни дейности",
  9: "3. Бюджетно салдо спрямо общите постъпления",
  12: "4. Размер на дълга, като процент",
  15: "5. Просрочени задължения като процент",
  18: "6. Население на един общински служител",
  21: "7. Дял на разходите за заплати и осигуровки",
  24: "8. Дял на капиталовите разходи",
  27: "9. Дял на капиталовите разходи в общите",
  30: "Общински приходи по чл. 45, ал. 1, т. 1 от ЗПФ",
  33: "Общински разходи по чл. 45, ал. 1, т. 2 от ЗПФ",
  36: "Бюджетно салдо",
  39: "Налични средства по бюджета",
  42: "Размер на общинския дълг",
  45: "Просрочени задължения по бюджет",
  48: "Задължения за разходи по бюджет",
  51: "Поети ангажименти за разходи по бюджет",
  54: "Дял на просрочените задължения по бюджета",
  57: "Дял на задълженията за разходи по бюджета",
  60: "Дял на поетите ангажименти по бюджета",
  63: "Събираемост на данък върху недвижимите имоти (%)",
  64: "Събираемост на данък върху превозните средства (%)",
  65: "Осреднена събираемост на двата данъка",
};

const MONEY_TITLE_COLS = [30, 33, 36, 39, 42, 45, 48, 51];

const titleRow = (unit = "(в лв.)"): unknown[] => {
  const r: unknown[] = new Array(65).fill(null);
  for (const [c, title] of Object.entries(GROUP_TITLE)) {
    const col = Number(c);
    r[col - 1] = MONEY_TITLE_COLS.includes(col) ? `${title} ${unit}` : title;
  }
  return r;
};

const sheet = (dataRows: unknown[][], unit?: string) => [
  titleRow(unit),
  headerRow(["2024 Q3", "2024 Q4", "2025 Q3"]),
  ...dataRows,
];

const parse = (
  dataRows: unknown[][],
  inRecovery?: Set<number>,
  unit?: string,
) =>
  parsePokazateli(sheet(dataRows, unit), {
    sourceFile: "fixture.xlsx",
    crosswalk: CROSSWALK,
    inRecovery,
  });

/** Every group gets a DISTINCT, position-encoded value: column N holds N*1000
 *  for money and N/10000 for ratios. A column map that shifts by one, or a
 *  group read at the wrong period offset, then fails a specific assertion
 *  instead of sliding past a fixture that only populated one group. */
const FULL_ROW = (): unknown[] => {
  const cells: Record<number, unknown> = { 1: 5101, 2: "Банско" };
  for (let c = 3; c <= 29; c++) cells[c] = c / 10000; // РМС indicators
  for (let c = 30; c <= 53; c++) cells[c] = c * 1000; // money levels
  for (let c = 54; c <= 62; c++) cells[c] = c / 10000; // ratios
  for (let c = 63; c <= 65; c++) cells[c] = c / 100; // collection
  return row(cells);
};

describe("parsePeriodLabel", () => {
  it("reads the workbook's period labels", () => {
    expect(parsePeriodLabel("2024 Q4")).toEqual({
      fiscalYear: 2024,
      quarter: 4,
      label: "2024 Q4",
    });
    expect(parsePeriodLabel("2025 Q3")?.quarter).toBe(3);
  });

  it("rejects anything that is not a period", () => {
    for (const bad of ["", null, "Общини", "2024", "2024 Q5", "24 Q1"]) {
      expect(parsePeriodLabel(bad)).toBeNull();
    }
  });
});

describe("readPeriods", () => {
  it("takes the periods from the header row, not the filename", () => {
    // The anchor is now passed in: it is the first indicator group this era
    // actually has, because the 2016 release omits one and a fixed column
    // would read the sequence from the wrong place.
    expect(
      readPeriods(headerRow(["2019 Q3", "2019 Q4", "2020 Q3"]), 3),
    ).toEqual([
      { fiscalYear: 2019, quarter: 3, label: "2019 Q3" },
      { fiscalYear: 2019, quarter: 4, label: "2019 Q4" },
      { fiscalYear: 2020, quarter: 3, label: "2020 Q3" },
    ]);
  });
});

describe("currencyForYear", () => {
  it("switches to euro at the 2026 changeover", () => {
    // The workbook states this explicitly: „лева, след 01.01.2026 г. - евро".
    expect(currencyForYear(2025)).toBe("BGN");
    expect(currencyForYear(2026)).toBe("EUR");
  });
});

describe("ratioBasisFor", () => {
  it("splits the year-end bases: arrears actual, the other two 4-year average", () => {
    // Only the Q4 column is the actual чл. 130а criterion, and even there the
    // three ratios do not share a denominator — arrears divides by ACTUAL
    // expenditure (т. 4), obligations and commitments by the 4-year average
    // (т. 2 / т. 3). Measured: 121/121 Q4 arrears ratios match `expenditure`
    // and none match the derived average.
    expect(ratioBasisFor(4)).toEqual({
      arrears: "actual",
      obligations: "avg4y",
      commitments: "avg4y",
    });
    for (const q of [1, 2, 3] as const) {
      expect(ratioBasisFor(q)).toEqual({
        arrears: "planned",
        obligations: "planned",
        commitments: "planned",
      });
    }
  });
});

describe("parsePokazateli", () => {
  it("emits one row per município per period", () => {
    const out = parse([row({ 1: 5101, 2: "Банско" })]);
    expect(out.periods).toHaveLength(3);
    expect(out.rows).toHaveLength(3);
    expect(out.rows.map((r) => `${r.fiscalYear}Q${r.quarter}`)).toEqual([
      "2024Q3",
      "2024Q4",
      "2025Q3",
    ]);
    expect(new Set(out.rows.map((r) => r.obshtina))).toEqual(
      new Set(["BLG01"]),
    );
  });

  it("reads each period from its own column within a group", () => {
    // Commitments group starts at col 51; the three periods are 51/52/53.
    const out = parse([
      row({ 1: 5101, 2: "Банско", 51: 1000, 52: 2000, 53: 3000 }),
    ]);
    expect(out.rows.map((r) => r.commitments?.amount)).toEqual([
      1000, 2000, 3000,
    ]);
  });

  it("converts лв to euro at the locked rate and keeps the native amount", () => {
    const out = parse([row({ 1: 5101, 2: "Банско", 52: 1_955_830 })]);
    const q4 = out.rows[1];
    expect(q4.commitments?.currency).toBe("BGN");
    expect(q4.commitments?.amount).toBe(1_955_830);
    expect(q4.commitments?.amountEur).toBeCloseTo(1_000_000, 0);
  });

  it("converts published fractions to percent", () => {
    // 0.01355 in the sheet means 1.355%.
    const out = parse([row({ 1: 5101, 2: "Банско", 55: 0.01355 })]);
    expect(out.rows[1].ratios.arrearsPct).toBeCloseTo(1.355, 6);
  });

  it("attaches collection rates to the year-end period only", () => {
    const out = parse([
      row({ 1: 5101, 2: "Банско", 63: 0.71, 64: 0.8, 65: 0.755 }),
    ]);
    expect(out.rows[0].collection).toBeNull(); // 2024 Q3
    expect(out.rows[2].collection).toBeNull(); // 2025 Q3
    expect(out.rows[1].collection).toEqual({
      dniPct: 71,
      dprsPct: 80,
      avgPct: 75.5,
    });
  });

  it("takes the recovery flag from the sibling sheet, never from the ratios", () => {
    // A município can be in a чл. 130д procedure while meeting no criterion,
    // and vice versa — they are different facts.
    const out = parse(
      [row({ 1: 5101, 2: "Банско" }), row({ 1: 7200, 2: "Столична община" })],
      new Set([5101]),
    );
    const byMuni = new Map(out.rows.map((r) => [r.mfCode, r]));
    expect(byMuni.get(5101)?.inRecoveryProcedure).toBe(true);
    expect(byMuni.get(7200)?.inRecoveryProcedure).toBe(false);
  });

  it("warns and skips a município the crosswalk cannot resolve", () => {
    // Skipping beats guessing, but it must be reported: a silently dropped
    // município is exactly the failure the crosswalk exists to prevent.
    const out = parse([row({ 1: 9999, 2: "Непозната" })]);
    expect(out.rows).toHaveLength(0);
    expect(out.mfCodes).toEqual([9999]);
    expect(out.warnings[0]).toMatch(/unresolved МФ code 9999/);
  });

  it("collects every МФ code seen, so diffRoster can compare coverage", () => {
    const out = parse([
      row({ 1: 5101, 2: "Банско" }),
      row({ 1: 7200, 2: "Столична община" }),
    ]);
    expect(out.mfCodes).toEqual([5101, 7200]);
  });

  it("reads EVERY money group from its own column, at the right period", () => {
    // The mutation this closes: 7 of 8 money groups and all 9 indicators had no
    // assertion at all, so swapping arrears with debtStock — or shifting every
    // group one column — left the suite green. Values are position-encoded
    // (column N holds N*1000), so each field names the column it must come from.
    const out = parse([FULL_ROW()]);
    const [q3a, q4, q3b] = out.rows;
    const at = (col: number) => col * 1000;
    expect(q3a.revenue?.amount).toBe(at(30));
    expect(q4.revenue?.amount).toBe(at(31));
    expect(q3b.revenue?.amount).toBe(at(32));
    expect(q4.expenditure?.amount).toBe(at(34));
    expect(q4.budgetBalance?.amount).toBe(at(37));
    expect(q4.cashOnHand?.amount).toBe(at(40));
    expect(q4.debtStock?.amount).toBe(at(43));
    expect(q4.arrears?.amount).toBe(at(46));
    expect(q4.expenseObligations?.amount).toBe(at(49));
    expect(q4.commitments?.amount).toBe(at(52));
  });

  it("reads every РМС 436/2017 indicator from its own column and period", () => {
    const out = parse([FULL_ROW()]);
    const [q3a, q4] = out.rows;
    const pctAt = (col: number) => (col / 10000) * 100;
    expect(q4.indicators.revenueSharePct).toBeCloseTo(pctAt(4), 9);
    expect(q4.indicators.localCoveragePct).toBeCloseTo(pctAt(7), 9);
    expect(q4.indicators.balanceSharePct).toBeCloseTo(pctAt(10), 9);
    expect(q4.indicators.debtToOwnRevenuePct).toBeCloseTo(pctAt(13), 9);
    expect(q4.indicators.arrearsToOwnRevenuePct).toBeCloseTo(pctAt(19), 9);
    expect(q4.indicators.wageSharePct).toBeCloseTo(pctAt(25), 9);
    expect(q4.indicators.capitalSharePct).toBeCloseTo(pctAt(28), 9);
    // The two LEVEL indicators keep their published units — no ×100.
    expect(q4.indicators.debtPerCapita).toBeCloseTo(16 / 10000, 9);
    expect(q4.indicators.populationPerEmployee).toBeCloseTo(22 / 10000, 9);
    // …and they must differ per period, or indicatorsAt is ignoring the offset.
    expect(q3a.indicators.revenueSharePct).toBeCloseTo(pctAt(3), 9);
  });

  it("reads all three ratio columns, not just the arrears one", () => {
    const out = parse([FULL_ROW()]);
    const q4 = out.rows[1];
    expect(q4.ratios.arrearsPct).toBeCloseTo((55 / 10000) * 100, 9);
    expect(q4.ratios.obligationsPct).toBeCloseTo((58 / 10000) * 100, 9);
    expect(q4.ratios.commitmentsPct).toBeCloseTo((61 / 10000) * 100, 9);
  });

  it("stamps the year-end arrears basis as actual, not the 4-year average", () => {
    // The three Q4 ratios do NOT share a denominator: arrears divides by actual
    // expenditure (чл. 130а т. 4) while the other two divide by the 4-year
    // average. One scalar for the row sent a consumer to the wrong denominator.
    const out = parse([FULL_ROW()]);
    expect(out.rows[1].ratioBasis).toEqual({
      arrears: "actual",
      obligations: "avg4y",
      commitments: "avg4y",
    });
    expect(out.rows[0].ratioBasis).toEqual({
      arrears: "planned",
      obligations: "planned",
      commitments: "planned",
    });
  });

  it("takes the currency from the declared unit, not from the year", () => {
    // The unit is declared per money GROUP in row 1 and governs all three
    // period columns, so a per-period inference cannot match the source. A
    // euro-denominated release of pre-2026 columns would otherwise be divided
    // by 1.95583 — a ~49% understatement at exit 0.
    const out = parse([FULL_ROW()], undefined, "(в евро)");
    expect(out.rows.map((r) => r.commitments?.currency)).toEqual([
      "EUR",
      "EUR",
      "EUR",
    ]);
    expect(out.rows[1].commitments?.amountEur).toBe(52 * 1000);
    expect(out.warnings.join(" ")).toMatch(/declares EUR but the year rule/);
  });

  it("warns when no unit is declared and falls back to the year rule", () => {
    // Titles present but carrying NO unit suffix — „no unit declared" is a
    // property of the title text, not of the title row being absent. An empty
    // row would fail the resolver instead, which is a different case with its
    // own test.
    const rows = [
      titleRow(""),
      headerRow(["2024 Q3", "2024 Q4", "2025 Q3"]),
      FULL_ROW(),
    ];
    const out = parsePokazateli(rows, {
      sourceFile: "no-unit.xlsx",
      crosswalk: CROSSWALK,
    });
    expect(out.rows[1].commitments?.currency).toBe("BGN");
    expect(out.warnings.join(" ")).toMatch(/no unit declared/);
  });

  it("refuses a workbook whose groups disagree about their periods", () => {
    // Group 1 defines the sequence and the other 19 must repeat it; an
    // unchecked extrapolation is how one quarter's money lands on another.
    const h = headerRow(["2024 Q3", "2024 Q4", "2025 Q3"]);
    h[51 - 1] = "2023 Q1"; // commitments group, first period column
    expect(() =>
      parsePokazateli([titleRow(), h, FULL_ROW()], {
        sourceFile: "shifted.xlsx",
        crosswalk: CROSSWALK,
      }),
    ).toThrow(/group „commitments" column 51 is „2023 Q1", expected „2024 Q3"/);
  });

  it("refuses a sheet whose header carries no periods", () => {
    // Titles present so the column map resolves — otherwise this trips the
    // resolver's own guard and stops testing the period check it names.
    expect(() =>
      parsePokazateli([titleRow(), [], row({ 1: 5101 })], {
        sourceFile: "bad.xlsx",
        crosswalk: CROSSWALK,
      }),
    ).toThrow(/expected 3 period columns/);
  });

  it("refuses a sheet whose titles name no money groups", () => {
    // The resolver's own guard, and the one that keeps a 2016 layout from
    // being read with the 2024 map: no titles means no anchor, and guessing
    // offsets is how „задължения" gets published as „просрочени".
    expect(() =>
      parsePokazateli([[], [], row({ 1: 5101 })], {
        sourceFile: "bad.xlsx",
        crosswalk: CROSSWALK,
      }),
    ).toThrow(/names no column for revenue/);
  });
});

describe("deriveAvg4y", () => {
  const ratios = {
    arrearsPct: null,
    obligationsPct: null,
    commitmentsPct: null,
  };
  const eur = (amountEur: number) => ({
    amount: amountEur,
    currency: "EUR" as const,
    amountEur,
  });

  it("recovers the чл. 130а denominator from the commitments pair", () => {
    // The workbook publishes no 4-year-average column; the ratio implies it.
    expect(
      deriveAvg4y({
        quarter: 4,
        commitments: eur(1000),
        expenseObligations: null,
        ratios: { ...ratios, commitmentsPct: 50 },
      }),
    ).toBeCloseTo(2000, 6);
  });

  it("falls back to the obligations pair", () => {
    expect(
      deriveAvg4y({
        quarter: 4,
        commitments: null,
        expenseObligations: eur(300),
        ratios: { ...ratios, obligationsPct: 15 },
      }),
    ).toBeCloseTo(2000, 6);
  });

  it("is null off the year-end quarter, where the denominator differs", () => {
    expect(
      deriveAvg4y({
        quarter: 3,
        commitments: eur(1000),
        expenseObligations: null,
        ratios: { ...ratios, commitmentsPct: 50 },
      }),
    ).toBeNull();
  });

  it("returns null rather than dividing by a zero or absent ratio", () => {
    for (const commitmentsPct of [0, null]) {
      expect(
        deriveAvg4y({
          quarter: 4,
          commitments: eur(1000),
          expenseObligations: null,
          ratios: { ...ratios, commitmentsPct },
        }),
      ).toBeNull();
    }
  });
});

describe("parseRecoverySheet", () => {
  it("reads МФ codes from row 5 onward, past the two extra marker rows", () => {
    const rows = [
      ["prev-trimester"],
      ["Q"],
      ["* footnote"],
      ["", "", "2024 Q3"],
      [5112, "Струмяни"],
      [6304, "Велинград"],
      [null, ""],
    ];
    expect([...parseRecoverySheet(rows)]).toEqual([5112, 6304]);
  });
});
