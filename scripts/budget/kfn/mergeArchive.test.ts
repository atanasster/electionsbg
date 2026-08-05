// The КФН archive merge. Pure, so every property is testable without a ZIP.
//
// What matters here is that the merge cannot LOSE a quarter. The writer this
// replaced overwrote the served file on every ingest, and the file is the
// durable store (raw_data/budget/ is gitignored, so the ZIPs are not) — which
// means a bad write is unrecoverable on a fresh clone, not merely stale.

import { describe, expect, it } from "vitest";
import {
  mergeKfnArchive,
  KfnShrinkError,
  KfnPillarGapError,
} from "./mergeArchive";
import type { KfnFundRow, KfnFundsFile, KfnFundsArchive } from "./parse_kfn";

const fund = (
  name: string,
  insured = 10,
  pillar: KfnFundRow["pillar"] = "UPF",
): KfnFundRow => ({
  pillar,
  pillarLabelBg: "Универсален (УПФ)",
  pillarLabelEn: "Universal (UPF)",
  pillarNumber: 2,
  fundName: name,
  companyBg: "Доверие",
  companyEn: "Doverie",
  insured,
  netAssetsBgn: null,
  netAssetsEur: 1000,
});

/** A COMPLETE quarter — all four pillars, which is what the guard demands. */
const allPillars = (): KfnFundRow[] => [
  fund("U", 10, "UPF"),
  fund("P", 10, "PPF"),
  fund("V", 10, "VPF"),
  fund("O", 10, "VPFOS"),
];

const parsed = (
  period: string,
  label: string,
  funds = allPillars(),
): KfnFundsFile => ({
  generatedAt: "2026-08-04T00:00:00.000Z",
  period,
  periodLabel: label,
  source: { publisher: "КФН", url: "https://fsc.bg", description: "quarterly" },
  funds,
});

const archive = (
  periods: { period: string; periodLabel: string; funds?: KfnFundRow[] }[],
): KfnFundsArchive => ({
  generatedAt: "2026-01-01T00:00:00.000Z",
  source: { publisher: "КФН", url: "https://fsc.bg", description: "quarterly" },
  latestPeriod: periods[periods.length - 1].period,
  periods: periods.map((p) => ({
    period: p.period,
    periodLabel: p.periodLabel,
    funds: p.funds ?? allPillars(),
  })),
});

describe("mergeKfnArchive", () => {
  it("seeds an archive from nothing", () => {
    const { archive: out, periodsBefore } = mergeKfnArchive(
      null,
      parsed("2025-06-30", "2025 Q2"),
    );
    expect(periodsBefore).toBe(0);
    expect(out.periods).toHaveLength(1);
    expect(out.latestPeriod).toBe("2025-06-30");
  });

  it("ADDS a new quarter rather than replacing the file", () => {
    const { archive: out, replaced } = mergeKfnArchive(
      archive([{ period: "2025-06-30", periodLabel: "2025 Q2" }]),
      parsed("2026-03-31", "2026 Q1"),
    );
    expect(replaced).toBe(false);
    expect(out.periods.map((p) => p.periodLabel)).toEqual([
      "2025 Q2",
      "2026 Q1",
    ]);
    expect(out.latestPeriod).toBe("2026-03-31");
  });

  it("sorts ascending regardless of ingest order", () => {
    // A back-catalogue is seeded newest-first as often as not.
    const { archive: out } = mergeKfnArchive(
      archive([{ period: "2026-03-31", periodLabel: "2026 Q1" }]),
      parsed("2025-06-30", "2025 Q2"),
    );
    expect(out.periods.map((p) => p.period)).toEqual([
      "2025-06-30",
      "2026-03-31",
    ]);
    expect(out.latestPeriod).toBe("2026-03-31");
  });

  it("is idempotent — re-parsing the same quarter changes nothing", () => {
    const before = archive([
      { period: "2025-06-30", periodLabel: "2025 Q2" },
      { period: "2026-03-31", periodLabel: "2026 Q1" },
    ]);
    const { archive: out, replaced } = mergeKfnArchive(
      before,
      parsed("2026-03-31", "2026 Q1"),
    );
    expect(replaced).toBe(true);
    expect(out.periods).toHaveLength(2);
    // generatedAt is preserved, so a re-run leaves the file byte-identical and
    // does not show up as a spurious diff.
    expect(out.generatedAt).toBe(before.generatedAt);
    expect(JSON.stringify(out.periods)).toBe(JSON.stringify(before.periods));
  });

  it("re-stamps generatedAt when a re-parse actually changes the numbers", () => {
    const before = archive([{ period: "2026-03-31", periodLabel: "2026 Q1" }]);
    const { archive: out } = mergeKfnArchive(
      before,
      parsed("2026-03-31", "2026 Q1", [
        fund("U", 999, "UPF"),
        fund("P", 10, "PPF"),
        fund("V", 10, "VPF"),
        fund("O", 10, "VPFOS"),
      ]),
    );
    expect(out.generatedAt).not.toBe(before.generatedAt);
    expect(out.periods[0].funds[0].insured).toBe(999);
  });

  it("replaces a quarter's contents on a corrected re-ingest", () => {
    const { archive: out } = mergeKfnArchive(
      archive([{ period: "2026-03-31", periodLabel: "2026 Q1" }]),
      parsed("2026-03-31", "2026 Q1", [
        ...allPillars(),
        fund("extra", 10, "UPF"),
      ]),
    );
    expect(out.periods).toHaveLength(1);
    expect(out.periods[0].funds).toHaveLength(5);
  });

  it("REFUSES a quarter that is missing a pillar", () => {
    // The real data loss, and the one the period count cannot see. An English
    // КФН archive ships both VPF_* and DPF_*; the matcher reached the wrong one
    // and the whole voluntary pillar vanished — 21 funds instead of 31, €851M
    // of assets — which then reads as growth against the next quarter.
    expect(() =>
      mergeKfnArchive(
        null,
        parsed("2025-06-30", "2025 Q2", [
          fund("U", 10, "UPF"),
          fund("P", 10, "PPF"),
          fund("O", 10, "VPFOS"),
        ]),
      ),
    ).toThrow(KfnPillarGapError);
  });

  it("names the missing pillar so the fix is findable", () => {
    try {
      mergeKfnArchive(
        null,
        parsed("2025-06-30", "2025 Q2", [fund("U", 10, "UPF")]),
      );
      throw new Error("should have thrown");
    } catch (e) {
      expect(String(e)).toContain("PPF");
      expect(String(e)).toContain("VPF");
      expect(String(e)).toContain("WORKBOOKS");
    }
  });

  it("never drops a quarter the archive already held", () => {
    // The guard's real job. A merge adds or replaces, so a shrink can only mean
    // the file on disk was truncated — and writing the smaller one over it is
    // the exact overwrite this function exists to end.
    const big = archive([
      { period: "2025-06-30", periodLabel: "2025 Q2" },
      { period: "2025-09-30", periodLabel: "2025 Q3" },
      { period: "2026-03-31", periodLabel: "2026 Q1" },
    ]);
    const { archive: out } = mergeKfnArchive(
      big,
      parsed("2026-06-30", "2026 Q2"),
    );
    expect(out.periods).toHaveLength(4);
  });

  it("throws KfnShrinkError if a merge would lose periods", () => {
    // Constructed by hand — the merge cannot produce this on its own, which is
    // why the guard is an assertion about the FILE rather than about the merge.
    const shrinking: KfnFundsArchive = {
      ...archive([{ period: "2026-03-31", periodLabel: "2026 Q1" }]),
      // A period list longer than what merge will return.
      periods: [
        { period: "2026-03-31", periodLabel: "2026 Q1", funds: [] },
        { period: "2026-03-31", periodLabel: "dup", funds: [] },
      ],
    };
    expect(() =>
      mergeKfnArchive(shrinking, parsed("2026-03-31", "2026 Q1")),
    ).toThrow(KfnShrinkError);
  });

  it("--allow-shrink overrides the guard", () => {
    const shrinking: KfnFundsArchive = {
      ...archive([{ period: "2026-03-31", periodLabel: "2026 Q1" }]),
      periods: [
        { period: "2026-03-31", periodLabel: "2026 Q1", funds: [] },
        { period: "2026-03-31", periodLabel: "dup", funds: [] },
      ],
    };
    const { archive: out } = mergeKfnArchive(
      shrinking,
      parsed("2026-03-31", "2026 Q1"),
      true,
    );
    expect(out.periods).toHaveLength(1);
  });
});
