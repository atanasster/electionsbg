// railSubsidyAnchor is the ONE rule /sector/transport/money and the /subsidies rail
// tile read, so a forwarded `pscope=y:YYYY` lands both on the same year.

import { describe, it, expect } from "vitest";
import {
  railSubsidyAnchor,
  railSubsidyRows,
  type RailSubsidyRow,
} from "./useRailSubsidy";

const row = (year: number, perPassenger: number | null): RailSubsidyRow => ({
  year,
  pso: 1,
  nkzhi: 1,
  bdzCapital: null,
  total: 2,
  capitalMissing: false,
  passengers: perPassenger == null ? null : 1,
  perPassenger,
});

const ROWS = [row(2023, 4), row(2024, 5), row(2025, 5.5), row(2026, null)];

describe("railSubsidyAnchor", () => {
  it("anchors on the requested year when it has a per-passenger figure", () => {
    expect(railSubsidyAnchor(ROWS, 2024)?.year).toBe(2024);
  });

  it("falls back to the newest year with a per-passenger figure", () => {
    expect(railSubsidyAnchor(ROWS)?.year).toBe(2025);
    expect(railSubsidyAnchor(ROWS, null)?.year).toBe(2025);
    // 2026 has a PSO row but no ridership yet; 2010 is outside the files.
    expect(railSubsidyAnchor(ROWS, 2026)?.year).toBe(2025);
    expect(railSubsidyAnchor(ROWS, 2010)?.year).toBe(2025);
  });

  it("returns null — never a row of zeros — when nothing is covered", () => {
    expect(railSubsidyAnchor([row(2026, null)], 2026)).toBeNull();
  });
});

describe("railSubsidyRows", () => {
  const ridership = {
    source: { name: "", dataset: "" },
    series: [
      { year: 2024, passengers: 20, passengerKmMio: null },
      { year: 2025, passengers: 20, passengerKmMio: null },
    ],
  };
  const subsidy = {
    source: { name: "", note: "", unit: "" },
    years: [
      // 2024: the law leaves both capital transfers blank.
      {
        fiscalYear: 2024,
        bdzPassengerPsoEur: 100,
        nkzhiOperatingEur: 50,
        bdzCapitalEur: null,
        nkzhiCapitalEur: null,
      },
      {
        fiscalYear: 2025,
        bdzPassengerPsoEur: 100,
        nkzhiOperatingEur: 50,
        bdzCapitalEur: 10,
        nkzhiCapitalEur: 20,
      },
    ],
  };

  it("never sums an unpublished capital transfer as 0 (T9 F3)", () => {
    const [y24, y25] = railSubsidyRows(subsidy, ridership);
    expect(y24.total).toBeNull();
    expect(y24.nkzhi).toBeNull();
    expect(y24.capitalMissing).toBe(true);
    // The PSO-only per-passenger figure is complete and stays.
    expect(y24.perPassenger).toBe(5);
    expect(y25.total).toBe(180);
    expect(y25.capitalMissing).toBe(false);
  });
});
