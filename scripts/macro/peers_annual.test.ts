// Shape guard for the `taxWedge` block in data/macro_peers.json (written by
// fetch_eu_peers.ts) and — the point of the file — for its agreement with the
// `taxWedge` series in data/macro.json (written by fetch_eurostat.ts).
//
// /indicators/economy renders the peer strip DIRECTLY ABOVE the chart line, and
// the two come from different files fetched by different scripts. They agree
// today only because the two configs happen to specify the same Eurostat slice
// (unit RT, freq A). If a future edit changes one and not the other, the page
// shows two authoritative-looking numbers for one indicator and nothing fails.
//
//   npx vitest run scripts/macro/peers_annual.test.ts

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

interface AnnualPoint {
  year: number;
  value: number;
}
interface Peers {
  indicatorsAnnual?: Record<
    string,
    {
      direction?: string;
      dataset?: string;
      series: Record<string, AnnualPoint[]>;
      latestDistribution: unknown;
    }
  >;
}
interface Macro {
  series: Record<string, { year: number; value: number }[]>;
}

const read = <T>(rel: string): T =>
  JSON.parse(readFileSync(resolve(__dirname, "../..", rel), "utf8")) as T;

const peers = read<Peers>("data/macro_peers.json");
const macro = read<Macro>("data/macro.json");

// The roster PeerSnapshotStripAnnual renders (STRIP_ORDER).
const STRIP_GEOS = ["BG", "EU27_2020", "RO", "GR", "HU", "HR"] as const;

describe("taxWedge peers block", () => {
  const tw = peers.indicatorsAnnual?.taxWedge;

  it("exists and carries the full strip roster", () => {
    expect(tw, "taxWedge missing from indicatorsAnnual").toBeTruthy();
    for (const g of STRIP_GEOS) {
      // 8 is the config's own minYears floor. EU27_2020 and HR start at 2013
      // (Eurostat's aggregate coverage), so this cannot be tightened to match
      // BG's 16 without going red on a correct fetch.
      expect(tw!.series[g]?.length ?? 0, g).toBeGreaterThanOrEqual(8);
    }
  });

  it("is a share of labour cost, not a fraction", () => {
    // Same guard as the macro.json side: an upstream republication of unit=RT
    // as a fraction keeps every point and passes every count-based check while
    // rendering a flat line on the axis.
    for (const p of tw!.series.BG) {
      expect(p.value, `taxWedge BG ${p.year}`).toBeGreaterThan(15);
      expect(p.value, `taxWedge BG ${p.year}`).toBeLessThan(60);
    }
  });

  it("agrees, to the digit, with the macro.json line it is rendered above", () => {
    const byYear = new Map(tw!.series.BG.map((p) => [p.year, p.value]));
    let compared = 0;
    for (const p of macro.series.taxWedge) {
      const peer = byYear.get(p.year);
      // The peers block starts at START_YEAR_ANNUAL (2010) while macro.json
      // starts at 2008, so the early years legitimately have no counterpart.
      if (peer === undefined) continue;
      expect(peer, `taxWedge ${p.year}`).toBe(p.value);
      compared++;
    }
    // Guards the guard: if the overlap ever became empty the loop above would
    // pass vacuously and this test would assert nothing at all.
    expect(compared).toBeGreaterThanOrEqual(12);
  });

  it("ships no distribution, because direction is 'none'", () => {
    // Pins the coupling documented on the config: direction "none" makes
    // fetchAnnualIndicatorDistribution return null, which is what keeps the
    // strip from rendering a rank badge. If this becomes non-null the
    // indicator starts asserting a "good direction" it deliberately avoids.
    expect(tw!.direction).toBe("none");
    expect(tw!.latestDistribution).toBeNull();
  });
});
