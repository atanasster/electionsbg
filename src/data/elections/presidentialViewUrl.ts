// The presidential pill's URL builder, for PlaceViewNav.
//
// ⚠ KEPT OUTSIDE placeViews.ts, ON PURPOSE — a circular import. presidentialRoutes.ts already
// imports ABROAD_OBLAST from placeViews.ts, so placeViews.ts importing presidentialUrl back
// from presidentialRoutes.ts would cycle. This file depends on both and is depended on by
// neither, which is the one shape that avoids it.
//
// ⚠ DECLINES RATHER THAN GUESSES on every place whose code shape in the presidential corpus is
// unverified:
//   - the Sofia city aggregate (SOF00 / SOF / SFO_CITY) — the presidential municipality file
//     carries no such row; Sofia is split by МИР (S23/S24/S25 at region level) and by район at
//     a numbering ("S2317", "S2323", …) that does NOT match the site's own S2xxx район scheme,
//     so it cannot be mapped without guessing;
//   - every Пловдив/Варна район, for the same "no verified mapping" reason;
//   - a composite settlement id (a Sofia район's "68134-2401") — the presidential settlement
//     file keys on plain numeric EKATTE only.
// A polling section drops to its parent settlement, the same rule every other view in
// placeViews.ts applies (section numbering does not carry across election kinds).
//
// ⚠ AN UNCOVERED PLACE IS NOT A DEAD LINK. Roughly a fifth of settlements have no presidential
// surface in a given cycle (measured on 2021: 4,184 of 5,364) — smaller settlements with no
// polling station, the same population every other view silently has nothing to show for. Unlike
// "local" (whose pill self-hides via useLocalElectionIndex, because the destination is a genuine
// 404), a presidential settlement/section page always renders: ElectionSurfaceBoundary's own
// fallback states "not published for this place" rather than erroring. So this builder resolves
// the URL whenever the CODE SHAPE is one it can place, without checking whether that cycle
// actually published a surface there — the reader lands on an honest empty state, not a 404.

import {
  isAbroadPlace,
  isSofiaCityObshtina,
  isSofiaRayonObshtina,
  type PlaceRef,
} from "@/data/local/placeViews";
import { findCityRayon } from "@/data/local/cityRayonCatalog";
import { presidentialUrl } from "./presidentialRoutes";

export const presidentialViewUrl = (
  p: PlaceRef,
  cycle: string,
): string | null => {
  if (!cycle) return null;
  if (isAbroadPlace(p)) return presidentialUrl(cycle, "abroad");
  if (p.level === "country") return presidentialUrl(cycle, "country");
  if (p.level === "region" && p.oblast)
    return presidentialUrl(cycle, "region", p.oblast);
  if (p.level === "municipality" && p.obshtina) {
    if (isSofiaCityObshtina(p.obshtina)) return null;
    if (isSofiaRayonObshtina(p.obshtina)) return null;
    if (findCityRayon(p.obshtina)) return null;
    return presidentialUrl(cycle, "municipality", p.obshtina);
  }
  if ((p.level === "settlement" || p.level === "section") && p.ekatte) {
    if (!/^\d+$/.test(p.ekatte)) return null;
    return presidentialUrl(cycle, "settlement", p.ekatte);
  }
  return null;
};
