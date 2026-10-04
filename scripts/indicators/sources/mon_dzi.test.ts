import { describe, expect, test } from "vitest";
import { withCarriedCachedYears } from "./mon_dzi";

const ref = (year: number, uuid = `u${year}`) => ({
  uuid,
  year,
  title: `${year}`,
});

describe("withCarriedCachedYears", () => {
  test("carries a cached year that rotated out of the listing", () => {
    // 2026-10: the 2021/22 primary session (our 2022) left the 10-resource window.
    const out = withCarriedCachedYears(
      [ref(2023), ref(2024)],
      [2022, 2023, 2024],
    );
    expect(out.map((r) => r.year)).toEqual([2022, 2023, 2024]);
    expect(out[0].uuid).toBe("");
  });

  test("a listed year wins over its cached copy", () => {
    const out = withCarriedCachedYears([ref(2024, "fresh")], [2024]);
    expect(out).toHaveLength(1);
    expect(out[0].uuid).toBe("fresh");
  });

  test("no cache leaves the listing unchanged", () => {
    expect(withCarriedCachedYears([ref(2025)], []).map((r) => r.year)).toEqual([
      2025,
    ]);
  });
});
