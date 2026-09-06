// A region's display name, in ONE place.
//
// ⚠⚠ `long_name` FIRST, AND SOFIA IS WHY. `regions.json` carries a `long_name` for exactly
// three rows — „София 23 МИР", „София 24 МИР", „София 25 МИР" — and a bare `name` for those is
// the string „23". Read wrongly they become three table rows whose entire link text is a
// number and three map buttons whose accessible name is a number, and because `localeCompare`
// sorts digits ahead of letters they are the FIRST three rows a reader meets. Two sibling
// components in this repo (`LocalRegionDashboardScreen`, `MapElement`) already do it this way.
//
// ⚠ IT IS ITS OWN MODULE BECAUSE TWO COMPONENTS MUST AGREE. The choropleth's accessible label
// and the table beside it name the same 31 places, and §4's text-equivalent rule is worth
// nothing if the two spell them differently — a reader matching the map's tooltip against the
// list would be comparing „София 23 МИР" with „23".

import type { RegionInfo } from "@/data/dataTypes";

/**
 * @param info - The row from `regions.json`, or `undefined` when the code resolved to none.
 * @param isBg - Whether the reader is on the Bulgarian side.
 * @param code - The oblast code, used as the last-resort label.
 * @returns The name to render. ⚠ NEVER AN EMPTY STRING — a blank place name on a result page
 *   is a heading about nowhere, and the code is ugly and honest.
 */
export const regionDisplayName = (
  info: RegionInfo | undefined,
  isBg: boolean,
  code: string,
): string => {
  if (!info) return code;
  // `||` rather than `??` throughout: these fields are typed as required, so the only value
  // that can reach a fallback is an EMPTY string — which `??` would pass through, dropping the
  // reader to a blank cell when a usable name was right there.
  const bg = info.long_name || info.name;
  const en = info.long_name_en || info.name_en || bg;
  return (isBg ? bg : en) || code;
};
