import { describe, expect, it } from "vitest";
import { ninatFingerprint } from "./eurostat_tourism_annual";

const resp = (updated: string | undefined, years: string[], bg = 1000) => ({
  updated,
  value: (years.length ? { "0": bg } : {}) as Record<string, number>,
  dimension: {
    time: {
      category: { index: Object.fromEntries(years.map((y, i) => [y, i])) },
    },
  },
});

describe("ninatFingerprint", () => {
  it("is the latest year plus Bulgaria's value; the dataset-wide stamp is detail only", () => {
    expect(
      ninatFingerprint(resp("2026-10-12T23:00:00+0200", ["2025"], 26000000)),
    ).toEqual({
      value: "tour_occ_ninat:2025:26000000",
      detail:
        "latest year 2025 · BG 26,000,000 nights · updated 2026-10-12T23:00:00+0200",
    });
  });
  it("a new year or a BG revision flips it; another country's revision does not", () => {
    const a = ninatFingerprint(resp("2026-10-12", ["2025"], 100)).value;
    expect(ninatFingerprint(resp("2027-10-12", ["2026"], 100)).value).not.toBe(
      a,
    );
    expect(ninatFingerprint(resp("2026-11-02", ["2025"], 101)).value).not.toBe(
      a,
    );
    expect(ninatFingerprint(resp("2026-11-02", ["2025"], 100)).value).toBe(a);
  });
  it("throws rather than reading an empty or malformed response as unchanged", () => {
    expect(() => ninatFingerprint(null)).toThrow(/empty/);
    expect(() => ninatFingerprint(resp(undefined, ["2025"]))).toThrow(
      /updated/,
    );
    expect(() => ninatFingerprint(resp("2026-10-12", []))).toThrow(
      /no annual period/,
    );
  });
});
