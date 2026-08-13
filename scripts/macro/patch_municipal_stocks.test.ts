// Gates for the patcher's one safety rule.
//
// `applyIndicators` exists as a pure function purely so this rule can be
// asserted: an empty rebuild must LEAVE the stored series alone. A run on a
// machine without `data/budget/municipal_fiscal/` would otherwise overwrite
// three live series in the COMMITTED macro.json with `[]`, and the tile would
// then suppress itself on a checkout where nothing is actually wrong.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { applyIndicators, type MacroFile } from "./patch_municipal_stocks";
import type { MunicipalStockIndicator } from "./municipal_stocks";

const point = (period: string, value: number) => ({
  year: Number(period.slice(0, 4)),
  quarter: Number(period.slice(6)) as 1 | 2 | 3 | 4,
  period,
  value,
  municipalityCount: 265,
  partial: false,
});

const indicator = (
  key: string,
  series: MunicipalStockIndicator["series"],
): MunicipalStockIndicator => ({
  source: "curated",
  key,
  cadence: "quarterly",
  sourceUrl: "https://www.minfin.bg/bg/810",
  titleEn: `${key} EN`,
  titleBg: `${key} BG`,
  unitLabelEn: "EUR million",
  unitLabelBg: "млн. евро",
  attributionEn: "NOT a component",
  attributionBg: "НЕ са част",
  series,
});

const macroWith = (value: number): MacroFile => ({
  indicators: { municipalArrears: { titleBg: "стар" } },
  series: { municipalArrears: [point("2024-Q4", value)] },
});

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("applyIndicators", () => {
  it("writes a rebuilt series over the stored one", () => {
    const macro = macroWith(73.1);
    const wrote = applyIndicators(macro, [
      indicator("municipalArrears", [point("2025-Q3", 75.4)]),
    ]);
    expect(wrote).toBe(1);
    expect(macro.series.municipalArrears).toEqual([point("2025-Q3", 75.4)]);
    expect(macro.indicators.municipalArrears).toMatchObject({
      titleBg: "municipalArrears BG",
      cadence: "quarterly",
      source: "curated",
    });
  });

  it("leaves an existing series UNTOUCHED when the rebuild is empty", () => {
    const macro = macroWith(73.1);
    const wrote = applyIndicators(macro, [indicator("municipalArrears", [])]);
    expect(wrote).toBe(0);
    expect(macro.series.municipalArrears).toEqual([point("2024-Q4", 73.1)]);
    expect(macro.indicators.municipalArrears).toEqual({ titleBg: "стар" });
  });

  it("does not create a key for an empty series that was never stored", () => {
    const macro: MacroFile = { indicators: {}, series: {} };
    expect(
      applyIndicators(macro, [indicator("municipalCommitments", [])]),
    ).toBe(0);
    expect(Object.keys(macro.series)).toEqual([]);
  });

  it("writes the non-empty siblings even when one is empty", () => {
    // The realistic shape: МФ froze the commitments column, so that one rebuild
    // is empty while arrears is current. Nothing about the frozen column may
    // stop the other two from being published.
    const macro: MacroFile = { indicators: {}, series: {} };
    const wrote = applyIndicators(macro, [
      indicator("municipalCommitments", []),
      indicator("municipalArrears", [point("2025-Q3", 75.4)]),
    ]);
    expect(wrote).toBe(1);
    expect(Object.keys(macro.series)).toEqual(["municipalArrears"]);
  });

  it("warns, rather than failing silently, on every skipped series", () => {
    applyIndicators({ indicators: {}, series: {} }, [
      indicator("municipalCommitments", []),
    ]);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("municipalCommitments"),
    );
  });
});
