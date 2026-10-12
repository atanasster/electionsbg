import { describe, it, expect } from "vitest";
import { withRollupCounts } from "./pinCounts";

const pin = (eik: string, n: number) => ({
  eik,
  loc: [0, 0] as [number, number],
  totalEur: 5,
  contractCount: n,
  bidKnownN: n,
  singleBidN: 1,
  singleBidShare: 1 / n,
});

describe("withRollupCounts", () => {
  it("takes the ex-member counts from the rollup and keeps the geometry", () => {
    const [p] = withRollupCounts(
      [pin("1", 1132)],
      [
        {
          eik: "1",
          contractCount: 968,
          bidKnownN: 700,
          singleBidN: 400,
          singleBidShare: 400 / 700,
        },
      ],
    );
    expect(p.contractCount).toBe(968);
    expect(p.singleBidN).toBe(400);
    expect(p.loc).toEqual([0, 0]);
    expect(p.totalEur).toBe(5);
  });

  it("leaves a pin with no rollup row as it is", () => {
    expect(withRollupCounts([pin("2", 10)], [])[0].contractCount).toBe(10);
  });
});
