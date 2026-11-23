// The OBLAST a person mention sits in, at the one grain where a national mention (a МИР
// candidacy or seat) and a local one (a council or mayoral term in an община) can be
// compared. Read by `sameNationalLocal` in cluster.ts. docs/plans/person-national-local-merge-v1.md §4.2.
//
// It exists because the two sides record place at DIFFERENT grains — a candidacy carries
// the МИР, a local term the община — so `weakBoth`'s string comparison can never bridge
// them. The obvious bridge, "the first three letters of the code", is wrong in two places,
// and both are the reason this is a function with its own tests rather than a `slice(0, 3)`:
//
//   • SOFIA CITY. Столична община's canonical code is `SFO_CITY`, and `SFO` is the МИР code
//     for Софийска ОБЛАСТ — the province around the city, a different electorate. A prefix
//     would compare every Sofia city councillor against Sofia-province MPs. The city is its
//     own key, covering МИР 23/24/25, the council (`SFO_CITY`) and the район shards
//     (`S2302`…`S2524`).
//   • PLOVDIV. The city МИР is `PDV-00` and the province МИР `PDV`; the Plovdiv obshtini are
//     all `PDV##`. One oblast, so one key.
//
// Anything else unrecognised returns null, and a null key never matches.

/** The single key Sofia city uses on both sides. Deliberately NOT a real place code, so it
 *  can never collide with one. */
export const SOFIA_CITY_KEY = "SOFIA_CITY";

const SOFIA_CITY_MIR = new Set(["S23", "S24", "S25"]);

/**
 * @param placeKind the typed place kind on the mention (`mir`, `obshtina`, …)
 * @param placeCode the canonical code for that kind
 * @returns the comparable oblast key, or null when this place cannot be compared
 */
export const oblastKeyFor = (
  placeKind: string | null | undefined,
  placeCode: string | null | undefined,
): string | null => {
  if (!placeCode) return null;
  if (placeKind === "mir") {
    if (SOFIA_CITY_MIR.has(placeCode)) return SOFIA_CITY_KEY;
    if (placeCode === "PDV-00") return "PDV";
    return /^[A-Z]{3}$/.test(placeCode) ? placeCode : null;
  }
  if (placeKind === "obshtina") {
    if (placeCode === "SFO_CITY") return SOFIA_CITY_KEY;
    // Sofia's районни: S + МИР number + two digits. All three МИР are the city.
    if (/^S2[345]\d{2}$/.test(placeCode)) return SOFIA_CITY_KEY;
    const m = /^([A-Z]{3})\d{2}$/.exec(placeCode);
    return m ? m[1] : null;
  }
  // Settlements (village mayors) and every other kind: out of scope for v1 (plan §6).
  return null;
};
