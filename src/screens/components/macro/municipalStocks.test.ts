// Gates for the two pure helpers behind the municipal-stocks tile.
//
// Both exist because the corpus has a hole in it BY DESIGN: when МФ freezes a
// column between releases the ingest withholds the field rather than repeating
// it, so a stock series legitimately skips a quarter that its siblings have.
// Every assertion below is about behaviour at that hole.

import { describe, it, expect } from "vitest";
import {
  buildRows,
  fmtEurM,
  latestPerStock,
  latestSharedQuarter,
  STOCKS,
} from "./municipalStocks";

const p = (period: string, value: number, extra: object = {}) => ({
  year: Number(period.slice(0, 4)),
  quarter: Number(period.slice(6)) as 1 | 2 | 3 | 4,
  period,
  value,
  ...extra,
});

describe("buildRows", () => {
  it("merges the three stocks onto one row per quarter", () => {
    const rows = buildRows({
      municipalCommitments: [p("2024-Q4", 4000)],
      municipalExpenseObligations: [p("2024-Q4", 400)],
      municipalArrears: [p("2024-Q4", 73)],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      period: "2024-Q4",
      municipalCommitments: 4000,
      municipalExpenseObligations: 400,
      municipalArrears: 73,
    });
  });

  it("sorts chronologically regardless of input order", () => {
    const rows = buildRows({
      municipalArrears: [p("2025-Q3", 75), p("2024-Q2", 60), p("2025-Q1", 70)],
    });
    expect(rows.map((r) => r.period)).toEqual([
      "2024-Q2",
      "2025-Q1",
      "2025-Q3",
    ]);
  });

  it("leaves a withheld stock UNDEFINED rather than zero", () => {
    // The load-bearing one. A frozen commitments column means „not published",
    // and a 0 there would render as „nothing contracted this quarter" — the
    // exact opposite of the fact, on the one figure this tile exists for.
    const rows = buildRows({
      municipalCommitments: [p("2025-Q2", 4162)],
      municipalArrears: [p("2025-Q2", 74), p("2025-Q3", 75)],
    });
    const q3 = rows.find((r) => r.period === "2025-Q3");
    expect(q3?.municipalCommitments).toBeUndefined();
    expect(q3?.municipalCommitments).not.toBe(0);
  });

  it("keeps the WIDEST reporting roster and flags any partial quarter", () => {
    const rows = buildRows({
      municipalCommitments: [
        p("2024-Q4", 4000, { municipalityCount: 260, partial: true }),
      ],
      municipalArrears: [p("2024-Q4", 73, { municipalityCount: 265 })],
    });
    expect(rows[0].count).toBe(265);
    expect(rows[0].partial).toBe(true);
  });

  it("does not flag a quarter where every stock has the full roster", () => {
    const rows = buildRows({
      municipalArrears: [p("2024-Q4", 73, { municipalityCount: 265 })],
    });
    expect(rows[0].partial).toBeUndefined();
  });

  it("returns nothing when no series is present", () => {
    expect(buildRows({})).toEqual([]);
  });
});

describe("latestSharedQuarter", () => {
  it("pairs the two readings at the SAME quarter", () => {
    const got = latestSharedQuarter(
      [p("2024-Q4", 4000), p("2025-Q2", 4162)],
      [p("2024-Q4", 9000), p("2025-Q2", 8640)],
    );
    expect(got).toEqual({ period: "2025-Q2", a: 4162, b: 8640 });
  });

  it("SKIPS a quarter the other series lacks rather than mixing dates", () => {
    // The rule this helper exists to enforce: these are stocks, so pairing a
    // Q3 commitment against a Q2 reserve compares two different days and
    // silently misstates the ratio. It must fall back to the newest quarter
    // both actually cover.
    const got = latestSharedQuarter(
      [p("2025-Q2", 4162), p("2025-Q3", 4300)],
      [p("2025-Q2", 8640)],
    );
    expect(got?.period).toBe("2025-Q2");
    expect(got?.a).toBe(4162);
  });

  it("finds the pair even when the inputs arrive unsorted", () => {
    const got = latestSharedQuarter(
      [p("2025-Q2", 4162), p("2024-Q4", 4000)],
      [p("2024-Q4", 9000), p("2025-Q2", 8640)],
    );
    expect(got?.period).toBe("2025-Q2");
  });

  it("returns null when the two never overlap", () => {
    expect(
      latestSharedQuarter([p("2025-Q2", 4162)], [p("2024-Q4", 9000)]),
    ).toBeNull();
  });

  it("returns null on an empty or absent series", () => {
    expect(latestSharedQuarter(undefined, [p("2024-Q4", 9000)])).toBeNull();
    expect(latestSharedQuarter([p("2024-Q4", 4000)], [])).toBeNull();
  });
});

describe("latestPerStock", () => {
  it("gives each stock its OWN newest quarter", () => {
    // The defect this closes: at 2025-Q3 МФ had frozen the commitments column,
    // so a card reading the last ROW printed „—" for the two figures the tile
    // is mainly about while the Q2 numbers sat one row above.
    const rows = buildRows({
      municipalCommitments: [p("2025-Q2", 4162)],
      municipalExpenseObligations: [p("2025-Q2", 386)],
      municipalArrears: [p("2025-Q2", 74), p("2025-Q3", 75)],
    });
    expect(latestPerStock(rows)).toEqual({
      municipalCommitments: { period: "2025-Q2", value: 4162 },
      municipalExpenseObligations: { period: "2025-Q2", value: 386 },
      municipalArrears: { period: "2025-Q3", value: 75 },
    });
  });

  it("omits a stock that was never published at all", () => {
    const rows = buildRows({ municipalArrears: [p("2024-Q4", 73)] });
    const got = latestPerStock(rows);
    expect(got.municipalCommitments).toBeUndefined();
    expect(got.municipalArrears).toEqual({ period: "2024-Q4", value: 73 });
  });

  it("takes the newest, not the first, when several quarters carry the stock", () => {
    const rows = buildRows({
      municipalCommitments: [
        p("2024-Q2", 3000),
        p("2024-Q4", 4000),
        p("2025-Q2", 4162),
      ],
    });
    expect(latestPerStock(rows).municipalCommitments?.period).toBe("2025-Q2");
  });

  it("returns nothing for an empty chart", () => {
    expect(latestPerStock([])).toEqual({});
  });
});

describe("latestSharedQuarter — points that cannot state a quarter", () => {
  it("refuses to pair with an ANNUAL series rather than fabricating Q4", () => {
    // The failure this closes: `arrears` in macro.json is annual — no `quarter`,
    // no `period` — so a `?? 4` default would have silently paired a Q4 stock
    // against a whole-year figure, which is the exact cross-date comparison this
    // helper exists to refuse.
    const annual = [{ year: 2024, value: 9000 }];
    expect(latestSharedQuarter([p("2024-Q4", 4000)], annual)).toBeNull();
  });

  it("refuses a non-positive comparand rather than rendering Infinity", () => {
    expect(
      latestSharedQuarter([p("2024-Q4", 4000)], [p("2024-Q4", 0)]),
    ).toBeNull();
    expect(
      latestSharedQuarter([p("2024-Q4", 4000)], [p("2024-Q4", -1)]),
    ).toBeNull();
  });

  it("still pairs a point that carries quarter but no period string", () => {
    const bare = [{ year: 2024, quarter: 4 as const, value: 9000 }];
    expect(latestSharedQuarter([p("2024-Q4", 4000)], bare)).toEqual({
      period: "2024-Q4",
      a: 4000,
      b: 9000,
    });
  });
});

describe("fmtEurM", () => {
  it("switches from millions to billions at a thousand", () => {
    expect(fmtEurM(999, "en")).toBe("€999 m");
    expect(fmtEurM(1000, "en")).toBe("€1 bn");
    expect(fmtEurM(4162.6, "en")).toBe("€4.16 bn");
  });

  it("uses the Bulgarian unit words under a bg locale", () => {
    expect(fmtEurM(75.4, "bg")).toContain("млн.");
    expect(fmtEurM(4162.6, "bg")).toContain("млрд.");
    // bg-BG uses a comma as the decimal separator, so the digits must come from
    // toLocaleString rather than toFixed.
    expect(fmtEurM(4162.6, "bg")).toContain("4,16");
  });

  it("treats any bg-* tag as Bulgarian, not only the bare code", () => {
    expect(fmtEurM(75.4, "bg-BG")).toContain("млн.");
  });

  it("rounds a sub-million figure to a whole million rather than dropping it", () => {
    // „€0 млн." is a poor reading but an honest one; what it must never do is
    // render an empty string or NaN.
    expect(fmtEurM(0.4, "en")).toBe("€0 m");
  });
});

describe("STOCKS", () => {
  it("is the single source of the three keys and their colours", () => {
    expect(STOCKS.map((s) => s.key)).toEqual([
      "municipalCommitments",
      "municipalExpenseObligations",
      "municipalArrears",
    ]);
    // Distinct colours: the chart draws all three side by side, so a repeat
    // would make two stocks indistinguishable.
    expect(new Set(STOCKS.map((s) => s.color)).size).toBe(3);
  });
});
