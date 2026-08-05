// Which blob a place reads, and why — the one rule, in plain TypeScript so both
// consumers can import it: the React hook that fetches at runtime, and the
// prerender that writes the crawler-facing region bodies at build time.
//
// Keeping it here rather than in the hook is what stops the two surfaces from
// disagreeing about Sofia. МОН publishes Столична община as ONE aggregate, so
// three region pages (Sofia's МИР trio) and one more (Пловдив-град) show a
// broader place's numbers. Whichever surface forgets that shows a city-wide
// matura average under a constituency's name with nothing said.

import { isSofiaRayonObshtina, SOFIA_REGIONS } from "@/data/dataTypes";
import { findCityRayon } from "@/data/local/cityRayonCatalog";

/** Why a place reads a BROADER aggregate than itself. The caller needs the
 *  REASON, not just the fact: each gets a different sentence, and "the whole
 *  city, not this МИР" and "the whole city, not this район" are different
 *  claims to a reader standing on one page or the other. */
export type PlaceAliasReason =
  | "sofia-city"
  | "sofia-city-raion"
  | "city-raion"
  | "plovdiv-province"
  | null;

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

/** At município grain the same aggregate is keyed `SOF00`. Sofia's 24 районы
 *  are obshtina codes in their own right (`S2309` Лозенец …) and each has a
 *  place page, but МОН publishes none of them separately. */
const SOFIA_CITY_OBSHTINA = "SOF00";

/** Plovdiv's МИР split is the same shape: `PDV-00` is the city constituency,
 *  while the education cut folds the city into the `PDV` oblast. */
const PLOVDIV_CITY_MIR = "PDV-00";
const PLOVDIV_OBLAST = "PDV";

/** Resolve a place code onto the code the education corpus is keyed by. */
export const resolveEducationPlaceKey = (code: string): PlaceKey => {
  if (SOFIA_REGIONS.includes(code))
    return { key: SOFIA_CITY_KEY, aliased: true, reason: "sofia-city" };
  if (isSofiaRayonObshtina(code))
    return {
      key: SOFIA_CITY_OBSHTINA,
      aliased: true,
      reason: "sofia-city-raion",
    };
  // Пловдив's and Варна's административни районы ("PDV22-01", "VAR06-05") are
  // the OTHER family of sub-city place ids `/governance/:id` serves, and МОН
  // splits neither city by район either. Without this they fall through to a
  // fetch that cannot succeed, and 11 prerendered pages quietly lose a section
  // their structurally identical Sofia counterparts show.
  const rayon = findCityRayon(code);
  if (rayon)
    return { key: rayon.obshtina, aliased: true, reason: "city-raion" };
  if (code === PLOVDIV_CITY_MIR)
    return { key: PLOVDIV_OBLAST, aliased: true, reason: "plovdiv-province" };
  return { key: code, aliased: false, reason: null };
};
