// The global home's tile registry — the ONE source of tile order for `/`.
//
// Pure data, no JSX: the scene is referenced by `id` (`HOME_SCENES[id]`), the same split
// `governanceRegistry.ts` and `sectorRegistry.ts` use. That is not only tidiness —
// `src/entryGraph.test.ts` fails if the entry chunk reaches a registry, and `routes.tsx`
// is a static import of the entry, so a constant taken from here into routing would drag
// this module and everything it names onto every page's critical path. (`sectorPacks` did
// exactly that once, for ~265 KB.)
//
// ⚠️ `HOME_BANDS` OWNS THE ORDER AND `HOME_TILES` IS DERIVED. Two hand-maintained lists is
// how a tile ends up in one and not the other; the `flatMap` below makes that impossible.
//
// Plan: docs/plans/home-dashboard-implementation-v1.md §4.2.

import { TILE_ACCENTS } from "@/ux/infographic";

export interface HomeTile {
  /** Scene key (`HOME_SCENES`) and the key the generator writes its metric under. */
  id: string;
  titleKey: string;
  /** ⚠️ Written out, never built as `${titleKey}_desc`. A template key defeats the i18n
   *  reachability analysis — `bundle_reachability.test.ts` treats a built template as naming
   *  EVERY key it could match, which is how one `${x}_desc` made eight deferred budget keys
   *  "reachable" from a page that cannot render them. */
  descKey: string;
  to: string;
  accent: string;
  /** Preserved params this destination has no concept of. See `InfographicTileProps`. */
  dropParams?: string[];
}

/** ⚠️ SIX OF THE EIGHT DESTINATIONS ARE SCOPE-FREE, so an inbound `?pscope` must not ride
 *  onto them. Verified per screen rather than assumed: only `/procurement` (which forces
 *  its own) and `/governance/sectors` read `useScope`. `/` itself ignores `pscope` — the
 *  four pulse figures are fixed-period national observations and the tile metrics are
 *  destination-owned folds, so there is no home window to resolve. */
const NO_SCOPE = ["pscope"];

export interface HomeBand {
  id: string;
  labelKey: string;
  descKey: string;
  tiles: HomeTile[];
}

export const HOME_BANDS: HomeBand[] = [
  {
    id: "everyday",
    labelKey: "home_band_everyday",
    descKey: "home_band_everyday_desc",
    tiles: [
      {
        id: "prices",
        titleKey: "home_tile_prices",
        descKey: "home_tile_prices_desc",
        to: "/consumption",
        accent: TILE_ACCENTS.clay,
        dropParams: NO_SCOPE,
      },
      {
        id: "my-area",
        titleKey: "home_tile_my_area",
        descKey: "home_tile_my_area_desc",
        to: "/my-area",
        accent: TILE_ACCENTS.emerald,
        dropParams: NO_SCOPE,
      },
      {
        id: "elections",
        titleKey: "home_tile_elections",
        descKey: "home_tile_elections_desc",
        // ⚠️ `/parliamentary`, not `/elections` — the latter is not a route in this plan
        // and belongs to the cross-kind elections hub. When that hub ships, this line and
        // the tile's label key move together, and the destination gate below is what stops
        // the repoint landing before the route exists.
        to: "/parliamentary",
        accent: TILE_ACCENTS.indigo,
        dropParams: NO_SCOPE,
      },
      {
        id: "sectors",
        titleKey: "home_tile_sectors",
        descKey: "home_tile_sectors_desc",
        to: "/governance/sectors",
        accent: TILE_ACCENTS.steel,
      },
    ],
  },
  {
    id: "public-money",
    labelKey: "home_band_public_money",
    descKey: "home_band_public_money_desc",
    tiles: [
      {
        id: "budget",
        titleKey: "home_tile_budget",
        descKey: "home_tile_budget_desc",
        to: "/budget",
        accent: TILE_ACCENTS.amber,
        dropParams: NO_SCOPE,
      },
      {
        id: "procurement",
        titleKey: "home_tile_procurement",
        descKey: "home_tile_procurement_desc",
        // ⚠️ The forced scope is part of the destination. The tile's number is the
        // ALL-SCOPE total, so opening the page on its default parliament window would show
        // a different figure from the one the reader just clicked.
        to: "/procurement?pscope=all",
        accent: TILE_ACCENTS.teal,
      },
      {
        id: "funds",
        titleKey: "home_tile_funds",
        descKey: "home_tile_funds_desc",
        to: "/funds",
        accent: TILE_ACCENTS.gold,
        dropParams: NO_SCOPE,
      },
      {
        id: "governance",
        titleKey: "home_tile_governance",
        descKey: "home_tile_governance_desc",
        to: "/governance",
        accent: TILE_ACCENTS.plum,
        dropParams: NO_SCOPE,
      },
    ],
  },
];

/** Every tile, in band order. DERIVED — see the header. */
export const HOME_TILES: HomeTile[] = HOME_BANDS.flatMap((b) => b.tiles);
