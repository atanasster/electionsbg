// Which blob a place reads, and why — the one rule, in plain TypeScript so both
// consumers can import it: the React hook that fetches at runtime, and the
// prerender that writes the crawler-facing region bodies at build time.
//
// Keeping it here rather than in the hook is what stops the two surfaces from
// disagreeing about Sofia. МОН publishes Столична община as ONE aggregate, so
// three region pages (Sofia's МИР trio) and one more (Пловдив-град) show a
// broader place's numbers. Whichever surface forgets that shows a city-wide
// matura average under a constituency's name with nothing said.

import { SOFIA_REGIONS } from "@/data/dataTypes";

/** Why a place reads a BROADER aggregate than itself. The caller needs the
 *  REASON, not just the fact: the two get different sentences. */
export type PlaceAliasReason = "sofia-city" | "plovdiv-province" | null;

export interface PlaceKey {
  /** The code actually fetched. */
  key: string;
  /** True when the numbers are a broader aggregate's, whether or not `key`
   *  differs from the requested code — see the Sofia note below. */
  aliased: boolean;
  reason: PlaceAliasReason;
}

/** The corpus keys the whole city under the FIRST Sofia МИР code (the loader
 *  maps `SOF00 → S23`). `S23` therefore needs the disclosure just as much as
 *  `S24` and `S25` do: the key matching the requested code is a COLLISION
 *  between the МИР code and the city aggregate's key, not evidence that the
 *  numbers are that МИР's. */
const SOFIA_CITY_KEY = SOFIA_REGIONS[0];

/** Plovdiv's МИР split is the same shape: `PDV-00` is the city constituency,
 *  while the education cut folds the city into the `PDV` oblast. */
const PLOVDIV_CITY_MIR = "PDV-00";
const PLOVDIV_OBLAST = "PDV";

/** Resolve a place code onto the code the education corpus is keyed by. */
export const resolveEducationPlaceKey = (code: string): PlaceKey => {
  if (SOFIA_REGIONS.includes(code))
    return { key: SOFIA_CITY_KEY, aliased: true, reason: "sofia-city" };
  if (code === PLOVDIV_CITY_MIR)
    return { key: PLOVDIV_OBLAST, aliased: true, reason: "plovdiv-province" };
  return { key: code, aliased: false, reason: null };
};
