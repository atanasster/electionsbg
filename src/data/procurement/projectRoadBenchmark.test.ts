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
