// The /funds hub registry — the single source of truth for the tiles the module fronts.
// Mirrors parliamentRegistry.ts / governanceRegistry.ts: pure data, the scene is referenced by
// `id` (FUNDS_SCENES[id]), so this module carries no JSX.
//
// Three bands, 10 tiles, 10 distinct accents (docs/plans/funds-hub-v1.md §2).
//
// TEN, not the plan's eleven. Its §2 sketched a 4/4/3 with a contract-browser tile in band 1 —
// but there is no contracts browser to point at: `/funds/contract/:number` is a SINGLE contract
// page, and `/funds/projects` does not exist. A tile pointing at a route that is not registered
// is a dead link no type system catches, so the tile is dropped rather than aimed at a guess.
// 3/4/3 balances on the four-column xl grid just as well: no band strands a tile on its own row.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// NO SEEDED TILES HERE, and that is a deliberate difference from the parliament registry.
// Every `to` below is a static path. The three destinations that used to be parameterised-only
// — `/funds/focus/:slug`, `/funds/interreg/:keepId`, `/funds/programme/:code` — got index pages
// in steps 3 and 5 precisely so this file would need no `seed` machinery: a tile carrying a
// generator-chosen id lands the reader on somebody else's subject and omits itself entirely
// whenever the generator produces nothing (dashboard-hub skill §4).
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// BAND ORDER follows funds-module-v2's measured demand, not the corpus's structure. ~68% of
// this audience arrives asking „can I get money" — which band 1 (open calls + the resolver,
// live above this grid) answers. What remains splits into „who got it", „is it clean" and
// „how fast is it moving", in that order: the first is what people search for, the second is
// what they share, the third is what an analyst opens.

import { TILE_ACCENTS } from "@/ux/infographic";

export interface FundsTile {
  /** Scene key (FUNDS_SCENES) and the tile's stable identity. */
  id: string;
  titleKey: string;
  descKey: string;
  /** Absolute destination. Always static — see the header on why there are no seeds. */
  to: string;
  /** A TILE_ACCENTS token. Unique across the whole page: all three bands render together, so
   *  a repeat reads as „these two tiles are the same kind of thing". */
  accent: string;
}

export interface FundsBand {
  labelKey: string;
  /** One line under the heading saying what is in the band. A heading names where you are;
   *  this says what you will find. */
  descKey: string;
  tiles: FundsTile[];
}

export const FUNDS_BANDS: FundsBand[] = [
  {
    // THREE / FOUR / THREE. The grid is four columns at xl, so what matters is that no band
    // leaves a single tile alone on a second row — checked on the rendered grid, not on the
    // array length. 3 and 4 both fit one row; 5 would not.
    labelKey: "funds_band_recipients",
    descKey: "funds_band_recipients_desc",
    tiles: [
      {
        // The organisations. First because „кой получи" is the question people type.
        id: "beneficiaries",
        titleKey: "funds_tile_beneficiaries",
        descKey: "funds_tile_beneficiaries_desc",
        to: "/funds/beneficiaries",
        accent: TILE_ACCENTS.clay,
      },
      {
        id: "programmes",
        titleKey: "funds_tile_programmes",
        descKey: "funds_tile_programmes_desc",
        to: "/funds/programmes",
        accent: TILE_ACCENTS.teal,
      },
      {
        id: "places",
        titleKey: "funds_tile_places",
        descKey: "funds_tile_places_desc",
        to: "/funds/places",
        accent: TILE_ACCENTS.moss,
      },
    ],
  },
  {
    // „Проверки и връзки", never „Още". A band called „Още" announces only that the band above
    // it mattered more, so everything under it reads as offcuts — and these four are the half
    // of the module people actually share.
    labelKey: "funds_band_checks",
    descKey: "funds_band_checks_desc",
    tiles: [
      {
        id: "political",
        titleKey: "funds_tile_political",
        descKey: "funds_tile_political_desc",
        to: "/funds/political",
        accent: TILE_ACCENTS.rose,
      },
      {
        id: "integrity",
        titleKey: "funds_tile_integrity",
        descKey: "funds_tile_integrity_desc",
        to: "/funds/integrity",
        accent: TILE_ACCENTS.amber,
      },
      {
        id: "dualCorpus",
        titleKey: "funds_tile_dual",
        descKey: "funds_tile_dual_desc",
        to: "/funds/dual-corpus",
        accent: TILE_ACCENTS.copper,
      },
      {
        id: "focus",
        titleKey: "funds_tile_focus",
        descKey: "funds_tile_focus_desc",
        to: "/funds/focus",
        accent: TILE_ACCENTS.plum,
      },
    ],
  },
  {
    labelKey: "funds_band_flow",
    descKey: "funds_band_flow_desc",
    tiles: [
      {
        id: "absorption",
        titleKey: "funds_tile_absorption",
        descKey: "funds_tile_absorption_desc",
        to: "/funds/absorption",
        accent: TILE_ACCENTS.azure,
      },
      {
        id: "rrf",
        titleKey: "funds_tile_rrf",
        descKey: "funds_tile_rrf_desc",
        to: "/funds/rrf",
        accent: TILE_ACCENTS.gold,
      },
      {
        // Interreg keeps its own tile rather than folding into „places": it is a DIFFERENT
        // CORPUS (zero rows in fund_projects — Interreg runs on Jems) and its money is a
        // partner's published budget, not a contract value. A tile beside the ИСУН ones
        // invites exactly the addition that is wrong.
        id: "interreg",
        titleKey: "funds_tile_interreg",
        descKey: "funds_tile_interreg_desc",
        to: "/funds/interreg",
        accent: TILE_ACCENTS.iris,
      },
    ],
  },
];

/** Every tile, flattened — for the gates and for the scene-coverage check. */
export const FUNDS_TILES: FundsTile[] = FUNDS_BANDS.flatMap((b) => b.tiles);
