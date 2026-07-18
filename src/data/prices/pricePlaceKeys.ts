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
  const sofia = sofiaRayon || isSofiaCityObshtina(obshtina);
  const priceObshtina = sofia ? SOFIA_CITY_PRICE_OBSHTINA : obshtina;
  // Sofia is monitored as ONE city-wide panel keyed 68134 — there is no
  // per-район or per-district shard. So map any Sofia settlement EKATTE (the
  // city 68134 itself OR a район composite 68134-<xxxx>) to the city shard,
  // and also fall back for an ekatte-less Sofia obshtina (SOF00/район). This
  // is why a район page previously showed an EMPTY basket: it passed the район
  // ekatte 68134-2401, which has no shard, so the `&& !ekatte` guard was
  // skipped. Non-Sofia ekattes are 5-digit and never collide with 68134.
  const isSofiaEkatte =
    ekatte === SOFIA_CITY_EKATTE ||
    (ekatte?.startsWith(`${SOFIA_CITY_EKATTE}-`) ?? false);
  const priceEkatte =
    isSofiaEkatte || (sofia && !ekatte) ? SOFIA_CITY_EKATTE : ekatte;
  return { priceObshtina, priceEkatte };
};
