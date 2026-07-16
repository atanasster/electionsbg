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

export const DECLARATION_TILES: DeclarationTile[] = [
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
