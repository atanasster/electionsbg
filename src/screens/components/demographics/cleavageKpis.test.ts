import { describe, it, expect } from "vitest";
import type { DemographicCleavagesPayload } from "@/data/dashboard/useDemographicCleavages";
import { computeCleavageKpis } from "./cleavageKpis";

const payload = (
  rows: DemographicCleavagesPayload["rows"],
): DemographicCleavagesPayload => ({
  election: "2026_04_19",
  parties: [
    { partyNum: 1, nickName: "A", pctNational: 40 },
    { partyNum: 2, nickName: "B", pctNational: 10 },
  ],
  rows,
});

describe("computeCleavageKpis", () => {
  it("returns undefined for a missing or empty payload", () => {
    expect(computeCleavageKpis(undefined)).toBeUndefined();
    expect(computeCleavageKpis(payload([]))).toBeUndefined();
  });

  it("reads rows[0] as the sharpest cleavage (payload is spread-sorted)", () => {
    const kpis = computeCleavageKpis(
      payload([
        { metric: "genderFemale", rs: [0.5, -0.9], spread: 1.4 },
        { metric: "age15_29", rs: [0.1, 0.2], spread: 0.1 },
      ]),
    );
    expect(kpis?.top).toEqual({ metric: "genderFemale", spread: 1.4 });
  });

  it("finds the abs-max correlation cell with an aligned party index", () => {
    // The strongest cell is -0.9 (row 0, party index 1).
    const kpis = computeCleavageKpis(
      payload([
        { metric: "genderFemale", rs: [0.5, -0.9], spread: 1.4 },
        { metric: "age15_29", rs: [0.1, 0.2], spread: 0.1 },
      ]),
    );
    expect(kpis?.best).toEqual({
      r: -0.9,
      metric: "genderFemale",
      partyIdx: 1,
    });
  });

  it("seeds from a real cell so an all-zero payload isn't a synthetic +0.00", () => {
    const kpis = computeCleavageKpis(
      payload([{ metric: "age15_29", rs: [0, 0], spread: 0 }]),
    );
    expect(kpis?.best.r).toBe(0);
    expect(kpis?.best.metric).toBe("age15_29");
    expect(kpis?.best.partyIdx).toBe(0);
  });
});
