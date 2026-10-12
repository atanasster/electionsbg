import { describe, expect, it } from "vitest";
import {
  KFP_CAPEX,
  STATE_BUDGET_CAPEX,
  executionPct,
  fiscalCouncilCapexIndicators,
  type CapexRow,
} from "./fiscal_council_capex";

// The rows are hand-transcribed from image tables, so every check here is
// against a figure the report prints somewhere ELSE — a typo in one row cannot
// satisfy both its own percentage and the period total.
const shortfall = (rows: CapexRow[]) =>
  rows.reduce((s, r) => s + (r.planBgnM - r.executedBgnM), 0);

describe("Fiscal Council capex execution", () => {
  it.each([
    ["ДБ", STATE_BUDGET_CAPEX],
    ["КФП", KFP_CAPEX],
  ] as const)("%s: every derived % matches the printed %", (_, rows) => {
    expect(rows.map((r) => r.year)).toEqual([
      2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024,
    ]);
    for (const r of rows) expect(executionPct(r)).toBe(r.publishedPct);
  });

  it("reproduces the report's headline shortfalls (6 383.3 / 15 296 млн. лв.)", () => {
    // The text rounds the ДБ total; the row sum is 6 383.4.
    expect(Math.abs(shortfall(STATE_BUDGET_CAPEX) - 6383.3)).toBeLessThan(0.15);
    expect(shortfall(KFP_CAPEX)).toBeCloseTo(15296, 1);
  });

  it("serves the derived percentages", () => {
    const [db, kfp] = fiscalCouncilCapexIndicators();
    expect(db.series.find((p) => p.year === 2021)?.value).toBe(31.5);
    expect(kfp.series.find((p) => p.year === 2023)?.value).toBe(112);
  });
});
