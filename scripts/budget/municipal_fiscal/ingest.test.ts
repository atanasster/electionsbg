// Gates for the cross-release merge.
//
// The two rules are inverses and must not be conflated: for the SAME quarter,
// two releases disagreeing is the problem; for DIFFERENT quarters, two releases
// agreeing exactly is the problem. Each test below asserts the rule fires AND
// that it stays quiet on the other rule's input, so neither can be satisfied by
// a predicate that always returns everything.

import { describe, it, expect } from "vitest";
import {
  buildQuarters,
  detectDisagreements,
  detectStaleFields,
} from "./ingest";
import type { MunicipalFiscalQuarter } from "./types";

const lv = (amount: number) => ({
  amount,
  currency: "BGN" as const,
  amountEur: amount / 1.95583,
});

/** Minimal row — only the fields the two detectors read. */
const mkRow = (
  mfCode: number,
  levels: Partial<Record<string, number>>,
): MunicipalFiscalQuarter =>
  ({
    mfCode,
    obshtina: `X${mfCode}`,
    nameBg: "Тест",
    fiscalYear: 2025,
    quarter: 2,
    indicators: { debtPerCapita: 42 },
    revenue: levels.revenue != null ? lv(levels.revenue) : null,
    expenditure: levels.expenditure != null ? lv(levels.expenditure) : null,
    budgetBalance: null,
    cashOnHand: null,
    debtStock: levels.debtStock != null ? lv(levels.debtStock) : null,
    arrears: levels.arrears != null ? lv(levels.arrears) : null,
    expenseObligations:
      levels.expenseObligations != null ? lv(levels.expenseObligations) : null,
    commitments: levels.commitments != null ? lv(levels.commitments) : null,
  }) as unknown as MunicipalFiscalQuarter;

describe("detectStaleFields — different quarters agreeing exactly", () => {
  it("flags a field identical for EVERY município", () => {
    // The real signature: МФ's Q2 release carried Q3 values for дълг,
    // задължения and ангажименти — byte-identical across all 265 общини.
    const older = [
      mkRow(1, { revenue: 10, commitments: 500 }),
      mkRow(2, { revenue: 20, commitments: 600 }),
    ];
    const newer = [
      mkRow(1, { revenue: 11, commitments: 500 }),
      mkRow(2, { revenue: 22, commitments: 600 }),
    ];
    expect(detectStaleFields(older, newer)).toEqual(["commitments"]);
  });

  it("does NOT flag a field that merely happens to match for some", () => {
    // One município's commitments being unchanged quarter-on-quarter is
    // ordinary; the rule requires every single one to match.
    const older = [
      mkRow(1, { commitments: 500 }),
      mkRow(2, { commitments: 600 }),
    ];
    const newer = [
      mkRow(1, { commitments: 500 }),
      mkRow(2, { commitments: 999 }),
    ];
    expect(detectStaleFields(older, newer)).toEqual([]);
  });

  it("returns nothing when the two sets share no município", () => {
    expect(
      detectStaleFields(
        [mkRow(1, { commitments: 5 })],
        [mkRow(9, { commitments: 5 })],
      ),
    ).toEqual([]);
  });

  it("ignores a column absent from BOTH quarters", () => {
    // Null-vs-null is trivially 'identical', but it means МФ stopped publishing
    // the column — not that an older release carried forward newer values.
    // Counting it would bury the real signal under every unpopulated field.
    expect(detectStaleFields([mkRow(1, {})], [mkRow(1, {})])).toEqual([]);
  });

  it("still flags a populated column even when others are empty", () => {
    // The discriminating half of the rule above: emptiness is excluded, but a
    // column that IS populated and identical everywhere is the real signature.
    expect(
      detectStaleFields(
        [mkRow(1, { commitments: 5 }), mkRow(2, { commitments: 6 })],
        [mkRow(1, { commitments: 5 }), mkRow(2, { commitments: 6 })],
      ),
    ).toEqual(["commitments"]);
  });
});

describe("detectDisagreements — the same quarter rendered twice", () => {
  it("flags any field where one município differs", () => {
    const a = [mkRow(1, { arrears: 100 }), mkRow(2, { arrears: 200 })];
    const b = [mkRow(1, { arrears: 100 }), mkRow(2, { arrears: 999 })];
    expect(detectDisagreements(a, b)).toEqual(["arrears"]);
  });

  it("stays silent when the two renderings agree — the verified Q4 case", () => {
    // Q4-2024 is byte-identical across both real releases on all eight level
    // groups; if this fired there, the merge would report an anomaly on every
    // ingest.
    const a = [mkRow(1, { arrears: 100, commitments: 5 })];
    const b = [mkRow(1, { arrears: 100, commitments: 5 })];
    expect(detectDisagreements(a, b)).toEqual([]);
  });

  it("ignores municipalities present in only one rendering", () => {
    // A município that did not file a given quarter is absent, not zero, and
    // absence is not a disagreement.
    const a = [mkRow(1, { arrears: 100 }), mkRow(2, { arrears: 200 })];
    const b = [mkRow(1, { arrears: 100 })];
    expect(detectDisagreements(a, b)).toEqual([]);
  });
});

describe("buildQuarters — blame the later QUARTER, not the older release", () => {
  const q = (
    year: number,
    quarter: 1 | 2 | 3 | 4,
    mf: number,
    levels: Record<string, number>,
  ): MunicipalFiscalQuarter => ({
    ...mkRow(mf, levels),
    fiscalYear: year,
    quarter,
  });
  const file = (
    name: string,
    quarters: string[],
    rows: MunicipalFiscalQuarter[],
  ) => ({
    file: name,
    rows,
    mfCodes: rows.map((r) => r.mfCode),
    warnings: [],
    quarters,
    rank: 0,
  });

  it("nulls the LATER quarter when a column is frozen forward", () => {
    // The defect this closes shipped once: blaming the older RELEASE deleted
    // genuine Q2 figures and republished them as Q3 under `newestQuarter`.
    // A value can only be carried forward, so the inheritor is the suspect —
    // confirmed by the workbook dates (the Q2 file predates Q3's close).
    const older = file(
      "q2.xlsx",
      ["2025-Q2"],
      [
        q(2025, 2, 1, { revenue: 10, commitments: 500 }),
        q(2025, 2, 2, { revenue: 20, commitments: 600 }),
      ],
    );
    const newer = file(
      "q3.xlsx",
      ["2025-Q3"],
      [
        q(2025, 3, 1, { revenue: 11, commitments: 500 }),
        q(2025, 3, 2, { revenue: 22, commitments: 600 }),
      ],
    );
    const { byQuarter, anomalies } = buildQuarters([older, newer]);
    // Q2 keeps its genuine figures…
    expect(byQuarter.get("2025-Q2")!.every((r) => r.commitments != null)).toBe(
      true,
    );
    // …and Q3, which inherited them, is the one nulled.
    expect(byQuarter.get("2025-Q3")!.every((r) => r.commitments == null)).toBe(
      true,
    );
    expect(anomalies.join(" ")).toMatch(/nulled on 2025-Q3, the later quarter/);
  });

  it("also nulls debtPerCapita, which is derived from the frozen дълг column", () => {
    const older = file(
      "q2.xlsx",
      ["2025-Q2"],
      [q(2025, 2, 1, { revenue: 1, debtStock: 9 })],
    );
    const newer = file(
      "q3.xlsx",
      ["2025-Q3"],
      [q(2025, 3, 1, { revenue: 2, debtStock: 9 })],
    );
    const { byQuarter } = buildQuarters([older, newer]);
    expect(byQuarter.get("2025-Q3")![0].indicators.debtPerCapita).toBeNull();
    expect(byQuarter.get("2025-Q2")![0].indicators.debtPerCapita).toBe(42);
  });

  it("keeps the later release for a quarter both cover, and reports a clash", () => {
    const a = file("old.xlsx", ["2024-Q4"], [q(2024, 4, 1, { arrears: 100 })]);
    const b = file(
      "new.xlsx",
      ["2024-Q4", "2025-Q3"],
      [q(2024, 4, 1, { arrears: 999 }), q(2025, 3, 1, { arrears: 5 })],
    );
    const { byQuarter, anomalies } = buildQuarters([a, b]);
    expect(byQuarter.get("2024-Q4")![0].arrears?.amount).toBe(999);
    expect(anomalies.join(" ")).toMatch(
      /2024-Q4 differs between releases on arrears/,
    );
  });
});
