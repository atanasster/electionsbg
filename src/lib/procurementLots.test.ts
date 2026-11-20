import { describe, expect, it } from "vitest";
import { groupByProcurement } from "./procurementLots";

const row = (key: string, amountEur: number | null, unp?: string, awarderEik = "000695114") => ({ key, amountEur, unp, awarderEik }); // prettier-ignore

describe("groupByProcurement", () => {
  it("folds the lots of one УНП into one row ranked by its total (A14)", () => {
    const g = groupByProcurement([
      row("a", 32_211_389, "00165-2021-0004"),
      row("x", 40_000_000),
      row("b", 16_972_257, "00165-2021-0004"),
      row("c", 12_792_523, "00165-2021-0004"),
    ]);
    expect(g).toHaveLength(2);
    expect(g[0].lead.key).toBe("a");
    expect(g[0].lots.map((l) => l.key)).toEqual(["a", "b", "c"]);
    expect(g[0].totalEur).toBe(61_976_169);
    expect(g[1].lead.key).toBe("x");
  });

  it("never merges rows without a УНП", () => {
    expect(groupByProcurement([row("a", 1), row("b", 2)])).toHaveLength(2);
  });

  it("keeps the same УНП under two awarders apart", () => {
    const g = groupByProcurement([
      row("a", 1, "u", "111111111"),
      row("b", 2, "u", "222222222"),
    ]);
    expect(g).toHaveLength(2);
  });

  it("ranks a null amount last within its group and counts it as 0", () => {
    const g = groupByProcurement([row("a", null, "u"), row("b", 5, "u")]);
    expect(g[0].lead.key).toBe("b");
    expect(g[0].totalEur).toBe(5);
  });
});
