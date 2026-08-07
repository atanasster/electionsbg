// The /governance/declarations sub-hub registry — the curated shortcut tiles for
// the "Декларации" area. Broadens the old MP-only dropdown cluster with the
// officials asset ranking (/officials/assets, ministers·mayors·governors), which
// was previously unreachable from the menu. Pure data; scenes by `id`.

import { TILE_ACCENTS } from "@/ux/infographic";

export interface DeclarationTile {
  id: string; // scene key (DECLARATION_SCENES)
  titleKey: string;
  descKey: string;
  to: string;
  accent: string;
}

export interface DeclarationBand {
  labelKey: string;
  descKey: string;
  tileIds: string[];
}

/** TWO bands, because the six tiles answer two different questions and the single band was
 *  named „Декларации" — the page title again, which is a label rather than a table of
 *  contents. The split is by SUBJECT: who is in the register, then what they declared.
 *
 *  Four and two, not six: the grid is four columns at xl, so six renders 4 + 2 with the
 *  second row half empty either way — but as two named bands those two tiles are a section
 *  rather than a remainder. */
export const DECLARATION_BANDS: DeclarationBand[] = [
  {
    labelKey: "decl_band_who",
    descKey: "decl_band_who_desc",
    tileIds: ["persons", "officials", "assets", "cars"],
  },
  {
    labelKey: "decl_band_business",
    descKey: "decl_band_business_desc",
    tileIds: ["companies", "connections"],
  },
];

export const DECLARATION_TILES: DeclarationTile[] = [
  {
    // First: it is the parent of the four leaderboards below it. Those each rank ONE
    // population by one measure; this browses every person the site can identify and
    // lets a reader arrive at the same rows from any direction.
    id: "persons",
    titleKey: "persons_title",
    descKey: "gov_hub_persons_desc",
    to: "/persons",
    accent: TILE_ACCENTS.indigo,
  },
  {
    id: "connections",
    titleKey: "connections_link_label",
    descKey: "decl_connections_desc",
    to: "/connections",
    accent: TILE_ACCENTS.rose,
  },
  {
    id: "assets",
    titleKey: "mp_assets_link_label",
    descKey: "decl_mp_assets_desc",
    to: "/mp-assets",
    accent: TILE_ACCENTS.amber,
  },
  {
    id: "cars",
    titleKey: "mp_cars_link_label",
    descKey: "decl_mp_cars_desc",
    to: "/mp-cars",
    accent: TILE_ACCENTS.steel,
  },
  {
    id: "companies",
    titleKey: "all_companies",
    descKey: "decl_mp_companies_desc",
    to: "/mp/companies",
    accent: TILE_ACCENTS.teal,
  },
  {
    id: "officials",
    titleKey: "decl_officials_title",
    descKey: "decl_officials_desc",
    to: "/officials/assets",
    accent: TILE_ACCENTS.plum,
  },
];
