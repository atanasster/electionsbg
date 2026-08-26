// The /indicators band, against points measured verbatim from the committed data/macro.json
// (read 2026-08-26).
//
// The §0 class this band lives inside: FOUR PERCENTAGES WITH FOUR DIFFERENT DENOMINATORS,
// on TWO different quarters. „2.7% · 5.8% · 3.0% · 28.5%" in one row reads as one scale, and
// three of the four are not comparable with each other at all.

import { describe, expect, it } from "vitest";
import {
  BAND_INDICATORS,
  indicatorsHubEvidence,
  indicatorsHubKpis,
  indicatorsKpiNote,
  promotedIndicators,
  type IndicatorPoint,
  type PeerRank,
} from "./indicatorsHubFigures";

/** Renders the key plus its interpolations, so a row built from the wrong argument shows up
 *  in the assertion rather than collapsing to a bare key. */
const t = (k: string, o?: Record<string, unknown>) =>
  o ? [k, ...Object.values(o).map(String)].join(":") : k;

/** Verbatim from data/macro.json — value, unitLabelBg and the period each series reaches. */
const POINTS: Record<string, IndicatorPoint> = {
  gdpGrowth: {
    value: 2.7,
    display: "2.7%",
    period: "2026-Q2",
    periodLabel: "2 тр. 2026",
    unitLabel: "% спрямо същия период предходна година (реален, SCA)",
    title: "Растеж на реалния БВП",
    to: "/indicators/economy",
  },
  inflation: {
    value: 5.83,
    display: "5.8%",
    period: "2026-Q2",
    periodLabel: "2 тр. 2026",
    unitLabel: "% спрямо предходната година (ХИПЦ, тримес. ср.)",
    title: "Инфлация (ХИПЦ)",
    to: "/indicators/economy",
  },
  unemployment: {
    value: 3,
    display: "3.0%",
    period: "2026-Q1",
    periodLabel: "1 тр. 2026",
    unitLabel: "% от активното население (сезонно изгладено)",
    title: "Безработица",
    to: "/indicators/economy",
  },
  govDebt: {
    value: 28.5,
    display: "28.5%",
    period: "2026-Q1",
    periodLabel: "1 тр. 2026",
    unitLabel: "% от БВП",
    title: "Брутен държавен дълг",
    to: "/indicators/fiscal",
  },
};

const band = (p: Record<string, IndicatorPoint> = POINTS) =>
  indicatorsHubKpis(p);

describe("the band", () => {
  it("carries the four promoted indicators, in registry order", () => {
    expect(band().map((c) => c.indicatorKey)).toEqual(BAND_INDICATORS);
  });

  it("pairs EVERY cell's own unit with its own period", () => {
    // The load-bearing clause. A bare percentage invites comparison with the three beside
    // it; the unit is what says the comparison is a category error.
    for (const c of band()) {
      const p = POINTS[c.indicatorKey!];
      expect(c.basis, `${c.indicatorKey} lost its unit`).toContain(p.unitLabel);
      expect(c.basis, `${c.indicatorKey} lost its period`).toContain(
        p.periodLabel,
      );
    }
  });

  it("reads the unit from the PAYLOAD, not from a table in the code", () => {
    // A hand-typed unit goes stale the day Eurostat re-bases a series, and the band would
    // then describe the figure wrongly with nothing failing.
    const rebased = {
      ...POINTS,
      govDebt: { ...POINTS.govDebt, unitLabel: "% от БВП (ESA 2020)" },
    };
    expect(band(rebased).at(-1)!.basis).toContain("(ESA 2020)");
  });

  it("does NOT assume one period for all four — they genuinely differ", () => {
    // Non-vacuity for the clause above and for the note: the quarterly series do not publish
    // together, so on the committed payload growth and inflation are Q2 while unemployment
    // and debt are Q1. A band showing one date for all four would be wrong about two.
    const periods = new Set(Object.values(POINTS).map((p) => p.periodLabel));
    expect(periods.size).toBeGreaterThan(1);
    const cellPeriods = new Set(
      band().map((c) => POINTS[c.indicatorKey!].periodLabel),
    );
    expect(cellPeriods.size).toBe(periods.size);
  });

  it("does NOT assume one denominator either", () => {
    // Three of the four are percentages of different things. If they ever collapsed to one
    // unit the note would be false copy rather than a caveat.
    expect(new Set(Object.values(POINTS).map((p) => p.unitLabel)).size).toBe(4);
  });

  it("WITHHOLDS a cell whose series has no point at the snapshot", () => {
    // The early elections in the selector predate several of these series. „0%" would be a
    // claim that the economy did not grow rather than that nobody measured it.
    const partial = { gdpGrowth: POINTS.gdpGrowth, govDebt: POINTS.govDebt };
    const cells = band(partial);
    expect(cells).toHaveLength(2);
    expect(cells.map((c) => c.indicatorKey)).toEqual(["gdpGrowth", "govDebt"]);
  });

  it("returns nothing at all when no series resolved", () => {
    // A payload still loading and a payload with nothing at this snapshot are the same shape
    // here, which is why the SCREEN keys its skeleton on the query's own `isPending`.
    expect(band({})).toEqual([]);
  });
});

describe("the destinations", () => {
  it("links every cell to the page that can name its series", () => {
    for (const c of band()) expect(String(c.to)).toMatch(/^\/indicators\//);
  });

  it("DELIBERATELY lets three cells share one destination", () => {
    // ⚠️ EVERY SIBLING HUB ASSERTS THE OPPOSITE, so this is written down rather than left to
    // look like an oversight. Three of the four are economy indicators and they all live on
    // /indicators/economy; a per-indicator anchor would distinguish them, but the `kpi-<key>`
    // id convention exists only on CabinetKpiTile (/governments/:id), not on the domain
    // pages. Pointing at an anchor that does not exist would be worse than sharing a page
    // that genuinely holds all three.
    const tos = band().map((c) => String(c.to));
    expect(new Set(tos).size).toBeLessThan(tos.length);
    expect(tos.filter((x) => x === "/indicators/economy")).toHaveLength(3);
  });
});

describe("the note", () => {
  it("says the four are not one scale", () => {
    expect(indicatorsKpiNote(band(), t)).toBe("indicators_kpi_note");
  });

  it("is withheld below two cells, where there is nothing to compare", () => {
    expect(indicatorsKpiNote([], t)).toBeUndefined();
    expect(indicatorsKpiNote(band().slice(0, 1), t)).toBeUndefined();
  });
});

describe("band ↔ grid, §3.1 rule 5", () => {
  it("promotes exactly the indicators that rendered", () => {
    expect([...promotedIndicators(band())].sort()).toEqual(
      [...BAND_INDICATORS].sort(),
    );
  });

  it("does not promote an indicator whose cell was withheld", () => {
    // The whole reason the set is derived: a constant list would blank the grid tile too and
    // drop the indicator off the page entirely.
    const partial = { gdpGrowth: POINTS.gdpGrowth };
    const promoted = promotedIndicators(band(partial));
    expect(promoted.has("gdpGrowth")).toBe(true);
    expect(promoted.has("inflation")).toBe(false);
  });
});

/** Verbatim from data/macro_peers.json (2026-08-26). Note the field sizes differ. */
const RANKS: PeerRank[] = [
  {
    indicatorKey: "gdpGrowth",
    title: "Растеж на реалния БВП",
    rank: 7,
    total: 22,
    to: "/indicators/economy",
  },
  {
    indicatorKey: "inflation",
    title: "Инфлация (ХИПЦ)",
    rank: 26,
    total: 27,
    to: "/indicators/economy",
  },
  {
    indicatorKey: "unemployment",
    title: "Безработица",
    rank: 1,
    total: 27,
    to: "/indicators/economy",
  },
  {
    indicatorKey: "govDebt",
    title: "Брутен държавен дълг",
    rank: 3,
    total: 27,
    to: "/indicators/fiscal",
  },
];

describe("the evidence rail", () => {
  const rail = (r: PeerRank[] = RANKS) => indicatorsHubEvidence(r, t);

  it("counts the rows it actually has, in the basis", () => {
    // ⚠️ THE RAIL IS 1–4 ROWS, NOT ALWAYS FOUR. The basis said „същите четири показателя"
    // — the same counting defect `indicatorsKpiNote` records being caught on the note,
    // which then survived here. A row is dropped whenever its peer period disagrees with
    // its figure's, and on 12 of the 13 elections in the selector that is EVERY row.
    expect(rail()!.basis).toBe("indicators_evidence_basis:4");
    expect(rail(RANKS.slice(0, 2))!.basis).toBe("indicators_evidence_basis:2");
  });

  it("ANSWERS the band — the same four, ranked", () => {
    const e = rail()!;
    expect(e.rows).toHaveLength(4);
    expect(new Set(e.rows.map((x) => x.id))).toEqual(new Set(BAND_INDICATORS));
  });

  it("puts the RANK first and the field size second", () => {
    // ⚠️ TWO `toContain`s CANNOT SEE ARGUMENT ORDER. Swapping `rank` and `total` renders
    // „22 от 7" — a standing that does not exist, on a rail whose whole job is to say
    // whether a figure is good — and every other clause in this file passed against it.
    // The interpolating stub joins the arguments in order, so this pins the order itself.
    const row = rail()!.rows.find((x) => x.id === "gdpGrowth")!;
    expect(row.value).toBe("indicators_evidence_rank:7:22");
    // …and a row whose rank exceeds its field is impossible by construction.
    for (const r of RANKS) expect(r.rank).toBeLessThanOrEqual(r.total);
  });

  it("carries the FIELD SIZE on every row, because the fields differ", () => {
    // Growth ranks in a field of 22 and the rest in 27 — five states had not reported that
    // quarter. „7th" beside „1st" invites a comparison of two different-sized fields.
    const e = rail()!;
    for (const row of e.rows) {
      const r = RANKS.find((x) => x.indicatorKey === row.id)!;
      expect(row.value).toContain(String(r.total));
      expect(row.value).toContain(String(r.rank));
    }
    // Non-vacuity: the totals really do differ in the fixture.
    expect(new Set(RANKS.map((r) => r.total)).size).toBeGreaterThan(1);
  });

  it("orders by SHARE OF THE FIELD, not by rank number", () => {
    expect(rail()!.rows.map((x) => x.id)).toEqual([
      "unemployment",
      "govDebt",
      "gdpGrowth",
      "inflation",
    ]);
  });

  it("…and the two orders genuinely differ when the fields do", () => {
    // ⚠️ ON THE REAL FIXTURE THEY COINCIDE (1, 3, 7, 26 sorts the same either way), so the
    // clause above cannot tell a percentile sort from a rank sort and a first draft of this
    // test asserted — falsely — that it could. The disagreement needs a SMALLER field to
    // show up: 7 of 22 is a worse standing than 8 of 27, and a rank sort puts it first.
    const fields: PeerRank[] = [
      { ...RANKS[0], indicatorKey: "gdpGrowth", rank: 7, total: 22 },
      { ...RANKS[1], indicatorKey: "inflation", rank: 8, total: 27 },
    ];
    expect(rail(fields)!.rows.map((x) => x.id)).toEqual([
      "inflation",
      "gdpGrowth",
    ]);
    const byRank = [...fields]
      .sort((a, b) => a.rank - b.rank)
      .map((r) => r.indicatorKey);
    expect(byRank).toEqual(["gdpGrowth", "inflation"]);
  });

  it("keys rows on the indicator, and links each to its domain page", () => {
    for (const row of rail()!.rows) {
      expect(BAND_INDICATORS).toContain(row.id);
      expect(String(row.to)).toMatch(/^\/indicators\//);
    }
    expect(rail()!.action?.to).toBe("/indicators/compare");
  });

  it("REFUSES an empty set rather than rendering a blank rail", () => {
    // The peers payload is a SEPARATE fetch from the macro one, so it can be absent while
    // the band is full — and „no ranks" under „where Bulgaria sits" reads as „nowhere".
    expect(indicatorsHubEvidence([], t)).toBeUndefined();
  });

  it("is deterministic when two indicators share a share of the field", () => {
    // A rail that reorders between renders is a rail whose gate cannot pin it.
    const tied: PeerRank[] = [
      { ...RANKS[2], indicatorKey: "unemployment", rank: 1, total: 27 },
      { ...RANKS[3], indicatorKey: "govDebt", rank: 1, total: 27 },
    ];
    expect(rail(tied)!.rows.map((x) => x.id)).toEqual(
      rail([...tied].reverse())!.rows.map((x) => x.id),
    );
  });
});
