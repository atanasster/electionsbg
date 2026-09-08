// Narrowing one round's flagged-district payload to the place a page is about.
//
// ⚠⚠ THE ARTIFACT IS NATIONAL AND THE PAGES ARE NOT. `neighborhoods.json` is written once per
// round and carries all eight districts; `/presidential/:cycle/region/PDV-00` is about one of
// them. Filtering the ROWS is the easy half — the hard half is that „дял от рисковите гласове"
// then divides by a different denominator, and a page that filtered the table while leaving the
// country's shares beneath it would publish the country's answer under a place's name.
//
// ⚠⚠ THIS IS WHY THE PRODUCER EMITS `places[].tickets`. Aggregating a subset needs each
// district's own ticket votes; deriving them from `leader.pct * valid` recovers one ticket, and
// rounded. The rule that the two must agree lives in `presidential_neighborhoods.data.test.ts`:
// scoping to the country must reproduce the artifact's own `tickets` array exactly.
//
// ⚠ AN EMPTY RESULT IS THE ORDINARY ANSWER. 8 districts sit in 5 oblasts, so ~26 of 31 region
// pages and ~268 of 273 municipality pages have nothing here — and the section self-hides
// rather than drawing „no risky districts", which reads as a finding about a place nobody
// screened.

import type {
  NeighborhoodPlace,
  NeighborhoodTicket,
  PresidentialNeighborhoods,
} from "./useNeighborhoods";

/** ⚠ NO `section` AND NO `abroad`. A section IS one polling station, so „the districts in this
 *  station" is not a question; and no catalogued district is abroad. Both levels exist in
 *  `PresidentialPlaceLevel`, so leaving them out of this union is what stops a caller passing
 *  one and getting a silently empty table under a heading. */
export type NeighborhoodScope =
  | { level: "country" }
  | { level: "region"; id: string }
  | { level: "municipality"; id: string }
  | { level: "settlement"; id: string };

export interface ScopedNeighborhoods {
  scope: NeighborhoodScope;
  /** The districts this scope contains, in the artifact's own order (by valid votes). */
  places: NeighborhoodPlace[];
  /** The ticket rows aggregated over exactly those districts. */
  tickets: NeighborhoodTicket[];
  /** The denominator `tickets[].pct` divides by — the districts' published base. */
  valid: number;
  sections: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Whether a district's stations sit in the scoped place.
 *
 *  ⚠ MEMBERSHIP, NOT EQUALITY. A district is a neighbourhood, so its stations can span two
 *  administrative codes — and `obshtini` / `ekattes` are EMPTY for the districts whose stations
 *  the placement pass refused (Sofia's Филиповци and Факултета, every cycle). An empty list
 *  matches nothing, which is the honest answer: the country page still carries the row. */
export const placeInScope = (
  p: NeighborhoodPlace,
  scope: NeighborhoodScope,
): boolean => {
  switch (scope.level) {
    case "country":
      return true;
    case "region":
      return p.oblasts.includes(scope.id);
    case "municipality":
      return p.obshtini.includes(scope.id);
    case "settlement":
      return p.ekattes.includes(scope.id);
  }
};

export const scopeNeighborhoods = (
  n: PresidentialNeighborhoods,
  scope: NeighborhoodScope,
): ScopedNeighborhoods => {
  const places = n.places.filter((p) => placeInScope(p, scope));
  // ⚠ THE COUNTRY TAKES THE ARTIFACT'S OWN ARRAY rather than re-deriving it. The producer
  // divides by the matched sections' base, which includes districts whose per-district rows
  // round independently; summing the rounded parts is not the same number. The data test pins
  // that the re-derivation agrees to within a rounding step, so this shortcut is a guarantee
  // rather than a divergence.
  if (scope.level === "country")
    return {
      scope,
      places,
      tickets: n.tickets,
      valid: n.coverage.validVotes,
      sections: n.coverage.sections,
    };

  const valid = places.reduce((s, p) => s + p.valid, 0);
  const sections = places.reduce((s, p) => s + p.sections, 0);
  const byNumber = new Map<number, NeighborhoodTicket>();
  for (const p of places)
    for (const t of p.tickets) {
      const cur = byNumber.get(t.number);
      if (cur) cur.votes += t.votes;
      // ⚠ A COPY. The artifact's objects are shared with every other consumer of this query —
      // React Query hands out the same reference — so accumulating into them would make each
      // re-scope add the votes again.
      else byNumber.set(t.number, { ...t });
    }
  const tickets = [...byNumber.values()]
    .map((t) => ({ ...t, pct: valid ? round2((100 * t.votes) / valid) : 0 }))
    .sort((a, b) => b.votes - a.votes || a.number - b.number);

  return { scope, places, tickets, valid, sections };
};

/** ⚠ THE SAME SHAPE AS `hasNeighborhoodContent`, one scope down: a heading over a blank is an
 *  insinuation about named districts, and at place scope the blank is the COMMON case. */
export const hasScopedContent = (s: ScopedNeighborhoods): boolean =>
  s.places.length > 0 && s.tickets.length > 0;
