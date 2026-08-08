import { describe, it, expect } from "vitest";
import { offProfileShare } from "./companyOffProfile";
import type { SectorRank } from "./CompanySectorRankTile";

const sector = (division: string, totalEur: number): SectorRank => ({
  division,
  totalEur,
  contractCount: 1,
  rank: 1,
  divContractors: 100,
  divTotalEur: 0,
  divMedianEur: 0,
});

describe("offProfileShare — company-level declared-activity mismatch", () => {
  it("is null without a declared NACE or without sectors", () => {
    expect(offProfileShare(null, [sector("45", 100)])).toBeNull();
    expect(offProfileShare("47", null)).toBeNull();
    expect(offProfileShare("47", [])).toBeNull();
  });

  it("is null when the NACE has no crosswalk opinion (a gap never fires the chip)", () => {
    // "12" (tobacco) is unmapped → every pairing unavailable → not evaluable.
    expect(offProfileShare("12", [sector("45", 100)])).toBeNull();
  });

  it("weights by VALUE: a retailer (47) mostly winning construction (45) is off-profile", () => {
    const share = offProfileShare("47", [
      sector("45", 800), // construction — mismatch for retail
      sector("15", 200), // food retail — a match (47 allows 15)
    ]);
    expect(share).toBeCloseTo(0.8, 5);
  });

  it("is 0 when every sector fits the declared activity", () => {
    // Construction firm (41) winning construction (45) + materials (44).
    expect(offProfileShare("41", [sector("45", 500), sector("44", 500)])).toBe(
      0,
    );
  });

  it("excludes universal CPV from the numerator (office supplies never count against)", () => {
    // 30 (office) and 79 (consulting) are universal → 'match', not off-profile.
    const share = offProfileShare("47", [
      sector("30", 500), // universal — match
      sector("45", 500), // construction — mismatch
    ]);
    expect(share).toBeCloseTo(0.5, 5);
  });

  it("skips €0 sectors from the denominator", () => {
    const share = offProfileShare("47", [
      sector("45", 1000), // construction — mismatch
      sector("15", 0), // food retail — a match, but €0 → skipped either way
    ]);
    expect(share).toBe(1); // only the construction sector carries value
  });
});
