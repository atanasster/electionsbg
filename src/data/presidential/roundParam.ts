// The URL parameter that carries the presidential round on screen — shared by the country page,
// the place pages, their maps and the polls views.
//
// ⚠ ITS OWN MODULE, IMPORT-FREE. `PresidentialChildMap` is reachable from the elections map
// registry (core), so importing the constant from the round-toggle component would drag that
// component — and the `presidential`-bundle keys it names — into the core closure, which
// `bundle_reachability.test.ts` fails on.

export const ROUND_PARAM = "pollRound";

/** The search a link should carry so the next page opens on the same round. Round 1 is the
 *  default and needs none. */
export const roundSearch = (round: 1 | 2): string =>
  round === 2 ? `?${ROUND_PARAM}=2` : "";
