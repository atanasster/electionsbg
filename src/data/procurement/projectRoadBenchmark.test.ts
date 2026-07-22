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
  it("returns the VALUE-WEIGHTED median €/km over the defensible member rows", () => {
    // Three build rows: 5 km/€5M (1M/km, w=5M), 10 km/€20M (2M/km, w=20M),
    // 20 km/€60M (3M/km, w=60M). Total weight 85M; half (42.5M) is crossed at the
    // 3M/km row → weighted median 3M/km (vs a plain median of 2M/km).
    const r = computeCorpusEurPerKm([
      road(10, 20_000_000, "a"),
      road(20, 60_000_000, "b"),
      road(5, 5_000_000, "c"),
    ]);
    expect(r).not.toBeNull();
    expect(r!.sampleCount).toBe(3);
    expect(r!.eurPerKmMedian).toBe(3_000_000);
    expect(r!.totalKm).toBe(35);
    expect(r!.contractedInSampleEur).toBe(85_000_000);
  });

  it("lets the big construction set the rate, not many cheap km-spanning rows", () => {
    // The Русе pathology: two €400M+ builds at ~10M/km plus several small survey
    // contracts that each span ~35 km at a tiny €/km. A plain median would land on
    // a survey row (~0.15M/km); value-weighting returns the real ~10M/km.
    const bigBuild = {
      key: "big",
      tag: "contract" as const,
      cpv: "45233120",
      amountEur: 400_000_000,
      title: "Строителство участък от км 0+000 до км 40+000", // 10M/km
    };
    const survey = (i: number) => ({
      key: `s${i}`,
      tag: "contract" as const,
      cpv: "45233120",
      amountEur: 1_800_000,
      title: `Строителство участък от км 0+000 до км 36+000`, // 0.05M/km
    });
    const r = computeCorpusEurPerKm([
      survey(1),
      survey(2),
      bigBuild,
      survey(3),
    ]);
    expect(r!.sampleCount).toBe(4);
    expect(r!.eurPerKmMedian).toBe(10_000_000); // the build, not a survey row
  });

  it("on an exact even money split returns the lower rate (>= total/2 convention)", () => {
    // Two rows carry the SAME €20M; a third €60M filler clears minSamples but sits
    // above both. Among the two equal-value rows the half-money boundary lands on
    // the lower €/km (2M/km at 10 km vs 2.5M/km at 8 km).
    const r = computeCorpusEurPerKm([
      road(8, 20_000_000, "b"), // 2.5M/km
      road(10, 20_000_000, "a"), // 2.0M/km
      road(20, 60_000_000, "c"), // 3.0M/km filler
    ]);
    // total weight 100M; sorted by €/km: 2.0M(w20M)→20M, 2.5M(w20M)→40M,
    // 3.0M(w60M)→100M. Half (50M) is crossed at 3.0M/km.
    expect(r!.eurPerKmMedian).toBe(3_000_000);
  });

  it("is invariant to input order among equal-€/km rows", () => {
    const rows = [
      road(10, 20_000_000, "a"), // 2M/km
      road(10, 20_000_000, "b"), // 2M/km (tie)
      road(20, 60_000_000, "c"), // 3M/km
    ];
    const forward = computeCorpusEurPerKm(rows)!.eurPerKmMedian;
    const reversed = computeCorpusEurPerKm([...rows].reverse())!.eurPerKmMedian;
    expect(forward).toBe(reversed);
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
