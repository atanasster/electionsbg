// Resolve a place's (obshtina, ekatte) to the keys the КЗП price tree is stored
// under. The feed is city-grain, so two quirks recur across every consumption
// surface:
//   1. A Sofia район (S2xxx) carries no basket of its own → fall back to the
//      Sofia city aggregate (settlement EKATTE 68134 / chains SOF46) so a район
//      page shows the capital's prices rather than an empty tile.
//   2. Sofia city is keyed SOF46 in the price tree but SOF00/SOF everywhere else
//      (governance / area resolver) → remap so its chains resolve, not 404.
// Centralized here (was copy-pasted in MyAreaPricesTile + ConsumptionPriceLevelTile)
// so the tiles, hub, chain and category pages all key identically.

import {
  isSofiaRayonObshtina,
  isSofiaCityObshtina,
} from "@/data/local/placeViews";

// EKATTE of Sofia city — the район fallback settlement key.
const SOFIA_CITY_EKATTE = "68134";
// Sofia city's key in the price tree (differs from the SOF00 governance id).
const SOFIA_CITY_PRICE_OBSHTINA = "SOF46";

export interface PriceKeys {
  /** obshtina key for chains / muni payloads (Sofia city/район → SOF46). */
  priceObshtina: string;
  /** settlement EKATTE key for the place payload (Sofia район → city 68134). */
  priceEkatte?: string;
}

export const resolvePriceKeys = (
  obshtina: string,
  ekatte?: string,
): PriceKeys => {
  const sofiaRayon = isSofiaRayonObshtina(obshtina);
  const priceObshtina =
    sofiaRayon || isSofiaCityObshtina(obshtina)
      ? SOFIA_CITY_PRICE_OBSHTINA
      : obshtina;
  // A Sofia район has no settlement shard → fall back to the city EKATTE, but
  // only when the caller didn't pass an explicit settlement ekatte.
  const priceEkatte = sofiaRayon && !ekatte ? SOFIA_CITY_EKATTE : ekatte;
  return { priceObshtina, priceEkatte };
};
