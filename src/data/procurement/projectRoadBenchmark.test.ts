import { describe, it, expect } from "vitest";
import { computeCorpusEurPerKm } from "./projectRoadBenchmark";

// Titles that roadAttributes parses to a defensible €/km: a build/reconstruction
// workType + a 0.5–50 km length + amount above the build floor. "участък от км
// A+000 до км B+000" is the length idiom lengthOf() recognises.
const road = (km: number, amountEur: number, key: string) => ({
  key,
  tag: "contract" as const,
  cpv: "45233120",
  amountEur,
  title: `Строителство на път I-1 участък от км 0+000 до км ${km}+000`,
});

describe("computeCorpusEurPerKm", () => {
  it("returns the median €/km over the defensible member road contracts", () => {
    // Three build rows: 10 km/€20M (2M/km), 20 km/€60M (3M/km), 5 km/€5M (1M/km).
    const r = computeCorpusEurPerKm([
      road(10, 20_000_000, "a"),
      road(20, 60_000_000, "b"),
      road(5, 5_000_000, "c"),
    ]);
    expect(r).not.toBeNull();
    expect(r!.sampleCount).toBe(3);
    expect(r!.eurPerKmMedian).toBe(2_000_000); // median of {1M, 2M, 3M}
    expect(r!.totalKm).toBe(35);
    expect(r!.contractedInSampleEur).toBe(85_000_000);
  });

  it("averages the two middle values for an even sample count", () => {
    // {1M, 2M, 3M, 4M} → mean of the two middle €/km = 2.5M.
    const r = computeCorpusEurPerKm([
      road(5, 5_000_000, "a"), // 1M/km
      road(10, 20_000_000, "b"), // 2M/km
      road(20, 60_000_000, "c"), // 3M/km
      road(10, 40_000_000, "d"), // 4M/km
    ]);
    expect(r!.sampleCount).toBe(4);
    expect(r!.eurPerKmMedian).toBe(2_500_000);
  });

  it("returns null below the minimum sample size", () => {
    expect(
      computeCorpusEurPerKm([
        road(10, 20_000_000, "a"),
        road(20, 60_000_000, "b"),
      ]),
    ).toBeNull();
  });

  it("ignores award rows and amendments (contract tag only)", () => {
    const rows = [
      road(10, 20_000_000, "a"),
      { ...road(20, 60_000_000, "b"), tag: "award" as const },
      { ...road(5, 5_000_000, "c"), tag: "contractAmendment" as const },
    ];
    // Only one contract-tagged row survives → below minSamples → null.
    expect(computeCorpusEurPerKm(rows)).toBeNull();
  });

  it("skips rows with no parseable length or sub-floor per-km", () => {
    const r = computeCorpusEurPerKm([
      road(10, 20_000_000, "a"),
      road(20, 60_000_000, "b"),
      road(5, 5_000_000, "c"),
      // No length in the title → skipped, doesn't inflate the sample.
      {
        key: "d",
        tag: "contract" as const,
        cpv: "45233120",
        amountEur: 9_000_000,
        title: "Ремонт на пътна настилка",
      },
    ]);
    expect(r!.sampleCount).toBe(3);
  });
});
