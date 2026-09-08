// Narrowing the flagged-district payload to one place — the arithmetic a place page publishes
// under that place's name.

import { describe, expect, it } from "vitest";
import {
  hasScopedContent,
  placeInScope,
  scopeNeighborhoods,
} from "./neighborhoodScope";
import type {
  NeighborhoodPlace,
  NeighborhoodRates,
  PresidentialNeighborhoods,
} from "./useNeighborhoods";

const rates: NeighborhoodRates = {
  turnoutPct: 24.25,
  invalidPct: null,
  additionalPct: 4.73,
  paperBallots: 0,
  actualVoters: 10658,
};

const place = (over: Partial<NeighborhoodPlace>): NeighborhoodPlace => ({
  id: "stolipinovo",
  name_bg: "Столипиново",
  name_en: "Stolipinovo",
  city_bg: "Пловдив",
  city_en: "Plovdiv",
  sourceUrl: "https://www.segabg.com/hot/x",
  sections: 70,
  valid: 1000,
  ...rates,
  oblasts: ["PDV-00"],
  obshtini: ["PDV22"],
  ekattes: ["56784"],
  tickets: [
    {
      number: 6,
      president: "Радев",
      votes: 500,
      pct: 50,
      pctNational: 49.42,
    },
    {
      number: 15,
      president: "Герджиков",
      votes: 200,
      pct: 20,
      pctNational: 22.83,
    },
  ],
  leader: { number: 6, president: "Радев", votes: 500, pct: 50 },
  ...over,
});

const SOFIA = place({
  id: "filipovci",
  name_bg: "Филиповци",
  name_en: "Filipovci",
  city_bg: "София",
  city_en: "Sofia",
  valid: 500,
  // ⚠ THE PLACEMENT-REFUSED SHAPE, and it is the corpus's real one: Sofia's two districts carry
  // an oblast and no município in four of the five cycles, and nothing at all on 2011.
  oblasts: ["S25"],
  obshtini: [],
  ekattes: [],
  tickets: [
    { number: 6, president: "Радев", votes: 100, pct: 20, pctNational: 49.42 },
    {
      number: 15,
      president: "Герджиков",
      votes: 300,
      pct: 60,
      pctNational: 22.83,
    },
  ],
  leader: { number: 15, president: "Герджиков", votes: 300, pct: 60 },
});

const payload = (
  over: Partial<PresidentialNeighborhoods> = {},
): PresidentialNeighborhoods => ({
  cycle: "2021_11_14_pvr",
  round: 1,
  basis: "КАВЕАТ",
  basisEn: "CAVEAT",
  coverage: {
    catalogue: 8,
    located: 2,
    missing: [],
    sections: 75,
    sectionsInCycle: 12488,
    validVotes: 1500,
    pctOfValid: 0.93,
  },
  national: { ...rates, turnoutPct: 37.2, invalidPct: 2.93 },
  totals: rates,
  tickets: [
    { number: 6, president: "Радев", votes: 600, pct: 40, pctNational: 49.42 },
    {
      number: 15,
      president: "Герджиков",
      votes: 500,
      pct: 33.33,
      pctNational: 22.83,
    },
  ],
  places: [place({}), SOFIA],
  ...over,
});

describe("placeInScope", () => {
  it("matches on membership, not equality — a district can span two codes", () => {
    const p = place({ ekattes: ["56784", "00000"] });
    expect(placeInScope(p, { level: "settlement", id: "00000" })).toBe(true);
    expect(placeInScope(p, { level: "settlement", id: "56784" })).toBe(true);
  });

  it("an EMPTY code list matches nothing, and that is the honest answer", () => {
    // ⚠⚠ Sofia's Филиповци has no município in the corpus. „Not here" is right; the country
    // page still carries the row, so nothing is lost — but a fallback that matched everything
    // would put a Sofia district on every município page in Bulgaria.
    expect(placeInScope(SOFIA, { level: "municipality", id: "SOF46" })).toBe(
      false,
    );
    expect(placeInScope(SOFIA, { level: "settlement", id: "68134" })).toBe(
      false,
    );
    expect(placeInScope(SOFIA, { level: "region", id: "S25" })).toBe(true);
  });

  it("country takes everything", () => {
    expect(placeInScope(SOFIA, { level: "country" })).toBe(true);
  });
});

describe("scopeNeighborhoods", () => {
  it("returns the ARTIFACT'S OWN ticket array at country scope", () => {
    // ⚠ NOT A RE-DERIVATION. The producer divides by the matched sections' base; summing the
    // districts' independently rounded shares is a different number, and the country page must
    // publish the producer's.
    const n = payload();
    const s = scopeNeighborhoods(n, { level: "country" });
    expect(s.tickets).toBe(n.tickets);
    expect(s.valid).toBe(n.coverage.validVotes);
    expect(s.sections).toBe(n.coverage.sections);
    expect(s.places).toHaveLength(2);
  });

  it("re-divides every share by the SCOPED districts, not the country's base", () => {
    // ⚠⚠ THE WHOLE POINT. Радев is 40% of the districts nationally and 50% of Столипиново
    // alone; a page that filtered the table and kept the artifact's shares would publish the
    // country's answer under Пловдив's name.
    const s = scopeNeighborhoods(payload(), { level: "region", id: "PDV-00" });
    expect(s.places.map((p) => p.id)).toEqual(["stolipinovo"]);
    expect(s.valid).toBe(1000);
    expect(s.sections).toBe(70);
    expect(s.tickets.map((t) => [t.number, t.votes, t.pct])).toEqual([
      [6, 500, 50],
      [15, 200, 20],
    ]);
  });

  it("re-ranks on the SCOPED sums, so the artifact's order cannot leak through", () => {
    // ⚠⚠ Радев leads the country's districts (600 to 500) and Герджиков leads Sofia's (300 to
    // 100). A list left in the artifact's order would name the wrong pair first on the Sofia
    // page — the leaderboard version of the same „right number, wrong subject" defect.
    const s = scopeNeighborhoods(payload(), { level: "region", id: "S25" });
    expect(s.places.map((p) => p.id)).toEqual(["filipovci"]);
    expect(s.tickets.map((t) => [t.number, t.votes, t.pct])).toEqual([
      [15, 300, 60],
      [6, 100, 20],
    ]);
  });

  it("sums a scope holding more than one district", () => {
    const both = payload({ places: [place({ oblasts: ["S25"] }), SOFIA] });
    const s = scopeNeighborhoods(both, { level: "region", id: "S25" });
    expect(s.valid).toBe(1500);
    expect(s.sections).toBe(140);
    expect(s.tickets.map((t) => [t.number, t.votes])).toEqual([
      [6, 600],
      [15, 500],
    ]);
  });

  it("keeps the ticket's PUBLISHED national share untouched", () => {
    // The comparison column is a fact about the country and must not be re-scaled by a filter.
    const s = scopeNeighborhoods(payload(), { level: "region", id: "PDV-00" });
    expect(s.tickets.find((t) => t.number === 6)?.pctNational).toBe(49.42);
  });

  it("does not MUTATE the artifact — React Query hands out one object", () => {
    // ⚠⚠ THE BUG A NAIVE ACCUMULATOR HAS. Two place pages in one session share the cached
    // payload, so accumulating into its ticket objects adds the votes again on every re-scope
    // and the figures grow as a reader navigates.
    const n = payload();
    const before = JSON.stringify(n);
    scopeNeighborhoods(n, { level: "region", id: "S25" });
    scopeNeighborhoods(n, { level: "region", id: "S25" });
    expect(JSON.stringify(n)).toBe(before);
  });

  it("is empty for a place holding no district", () => {
    const s = scopeNeighborhoods(payload(), { level: "region", id: "BLG" });
    expect(s.places).toEqual([]);
    expect(s.tickets).toEqual([]);
    expect(s.valid).toBe(0);
    expect(hasScopedContent(s)).toBe(false);
  });

  it("hasScopedContent is true only with BOTH districts and tickets", () => {
    expect(
      hasScopedContent(scopeNeighborhoods(payload(), { level: "country" })),
    ).toBe(true);
    // A district whose protocols carry no ticket row cannot answer „who led here".
    const mute = payload({ places: [place({ tickets: [], leader: null })] });
    expect(
      hasScopedContent(
        scopeNeighborhoods(mute, { level: "region", id: "PDV-00" }),
      ),
    ).toBe(false);
  });
});
