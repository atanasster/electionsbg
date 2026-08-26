// The /indicators band, against points measured verbatim from the committed data/macro.json
// (read 2026-08-26).
//
// The §0 class this band lives inside: FOUR PERCENTAGES WITH FOUR DIFFERENT DENOMINATORS,
// on TWO different quarters. „2.7% · 5.8% · 3.0% · 28.5%" in one row reads as one scale, and
// three of the four are not comparable with each other at all.

import { describe, expect, it } from "vitest";
import {
  BAND_INDICATORS,
  indicatorsHubKpis,
  indicatorsKpiNote,
  promotedIndicators,
  type IndicatorPoint,
} from "./indicatorsHubFigures";

const t = (k: string) => k;

/** Verbatim from data/macro.json — value, unitLabelBg and the period each series reaches. */
const POINTS: Record<string, IndicatorPoint> = {
  gdpGrowth: {
    value: 2.7,
    display: "2.7%",
    periodLabel: "2 тр. 2026",
    unitLabel: "% спрямо същия период предходна година (реален, SCA)",
    title: "Растеж на реалния БВП",
    to: "/indicators/economy",
  },
  inflation: {
    value: 5.83,
    display: "5.8%",
    periodLabel: "2 тр. 2026",
    unitLabel: "% спрямо предходната година (ХИПЦ, тримес. ср.)",
    title: "Инфлация (ХИПЦ)",
    to: "/indicators/economy",
  },
  unemployment: {
    value: 3,
    display: "3.0%",
    periodLabel: "1 тр. 2026",
    unitLabel: "% от активното население (сезонно изгладено)",
    title: "Безработица",
    to: "/indicators/economy",
  },
  govDebt: {
    value: 28.5,
    display: "28.5%",
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
