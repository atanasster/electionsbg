// The `/elections` tile registry — the ONE source of tile order for the cross-kind hub.
//
// Pure data, no JSX: the scene is referenced by `id` (`ELECTIONS_SCENES[id]`), the split
// `homeRegistry.ts` and `analysisRegistry.ts` use. That is not tidiness — `src/entryGraph.test.ts`
// fails if the entry chunk reaches a registry, and `routes.tsx` is a static import of the entry,
// so a constant taken from here into routing would drag this module and every scene it names
// onto every page's critical path. (`sectorPacks` did exactly that once, for ~265 KB.)
//
// ⚠ `ELECTIONS_BANDS` OWNS THE ORDER AND `ELECTIONS_TILES` IS DERIVED. Two hand-maintained lists
// is how a tile ends up in one and not the other; the `flatMap` below makes it unrepresentable
// rather than merely detectable (§6.1).
//
// ⚠ THE CYCLE-SCOPED DESTINATIONS ARE PINNED TO THE LATEST CYCLE HERE AND REWRITTEN AT RENDER.
// A `to` has to be a literal absolute path for the gate to check it is routed at all, and
// `LATEST_LOCAL_CYCLE` is a constant — but a reader who selected an older election must not be
// handed the latest cycle's município list, which is the silent disagreement §3.2 is about. So a
// cycle-scoped tile carries `cycleScoped: true` and the screen substitutes the cycle
// `useLatestLocalCycle()` resolves for the selected election. `withLocalCycle` is that rewrite,
// and it lives beside the flag so the two cannot drift.
//
// Plan: docs/plans/elections-hub-implementation-v1.md §6.1, Phase 3 item 5.

import { TILE_ACCENTS } from "@/ux/infographic";
import { LATEST_LOCAL_CYCLE } from "@/data/local/useLatestLocalCycle";

export interface ElectionsTile {
  /** Scene key (`ELECTIONS_SCENES`). */
  id: string;
  titleKey: string;
  /** ⚠ Written out, never built as `${titleKey}_desc`. A template key defeats the i18n
   *  reachability analysis — `bundle_reachability.test.ts` treats a built template as naming
   *  EVERY key it could match (§6.1). */
  descKey: string;
  to: string;
  accent: string;
  /** Whether `to` embeds a local-election cycle the screen must re-resolve. */
  cycleScoped?: boolean;
}

export interface ElectionsBand {
  id: string;
  labelKey: string;
  descKey: string;
  tiles: ElectionsTile[];
}

const c = LATEST_LOCAL_CYCLE;

export const ELECTIONS_BANDS: ElectionsBand[] = [
  {
    id: "results",
    labelKey: "elections_band_results",
    descKey: "elections_band_results_desc",
    tiles: [
      {
        id: "parliamentary",
        titleKey: "elections_tile_parliamentary",
        descKey: "elections_tile_parliamentary_desc",
        to: "/parliamentary",
        accent: TILE_ACCENTS.indigo,
      },
      {
        id: "local",
        titleKey: "elections_tile_local",
        descKey: "elections_tile_local_desc",
        to: `/local/${c}`,
        accent: TILE_ACCENTS.emerald,
        cycleScoped: true,
      },
      {
        id: "mayors-by-party",
        titleKey: "local_leaderboard_mayors_by_party",
        descKey: "elections_tile_mayors_by_party_desc",
        to: `/local/${c}/mayors-by-party`,
        accent: TILE_ACCENTS.rose,
        cycleScoped: true,
      },
      {
        id: "council-votes",
        titleKey: "local_leaderboard_council_votes",
        descKey: "elections_tile_council_votes_desc",
        to: `/local/${c}/council-votes`,
        accent: TILE_ACCENTS.teal,
        cycleScoped: true,
      },
    ],
  },
  {
    id: "places",
    labelKey: "elections_band_places",
    descKey: "elections_band_places_desc",
    tiles: [
      {
        id: "municipalities",
        titleKey: "local_national_municipalities",
        descKey: "elections_tile_municipalities_desc",
        to: `/local/${c}/municipalities`,
        accent: TILE_ACCENTS.steel,
        cycleScoped: true,
      },
      {
        id: "regions",
        titleKey: "local_all_regions",
        descKey: "elections_tile_regions_desc",
        to: `/local/${c}/regions`,
        accent: TILE_ACCENTS.azure,
        cycleScoped: true,
      },
      {
        id: "runoffs",
        titleKey: "local_national_runoffs",
        descKey: "elections_tile_runoffs_desc",
        to: `/local/${c}/runoffs`,
        accent: TILE_ACCENTS.amber,
        cycleScoped: true,
      },
      {
        id: "split-control",
        titleKey: "local_national_split_control",
        descKey: "elections_tile_split_control_desc",
        to: `/local/${c}/split-control`,
        accent: TILE_ACCENTS.plum,
        cycleScoped: true,
      },
    ],
  },
  {
    id: "analysis",
    labelKey: "elections_band_analysis",
    descKey: "elections_band_analysis_desc",
    tiles: [
      {
        id: "analysis-hub",
        titleKey: "analysis_hub_nav",
        descKey: "elections_tile_analysis_desc",
        to: "/parliamentary/analysis",
        accent: TILE_ACCENTS.mulberry,
      },
      {
        id: "reports-hub",
        titleKey: "reports_hub_nav",
        descKey: "elections_tile_reports_desc",
        to: "/parliamentary/reports",
        accent: TILE_ACCENTS.clay,
      },
      {
        id: "strongest-mandates",
        titleKey: "local_leaderboard_strongest_mandates",
        descKey: "elections_tile_strongest_mandates_desc",
        to: `/local/${c}/strongest-mandates`,
        accent: TILE_ACCENTS.brass,
        cycleScoped: true,
      },
      {
        id: "closest-races",
        titleKey: "local_leaderboard_closest_races",
        descKey: "elections_tile_closest_races_desc",
        to: `/local/${c}/closest-races`,
        accent: TILE_ACCENTS.wine,
        cycleScoped: true,
      },
    ],
  },
  {
    id: "partial",
    labelKey: "elections_band_partial",
    descKey: "elections_band_partial_desc",
    tiles: [
      {
        id: "chmi",
        titleKey: "chmi_feed_title",
        descKey: "elections_tile_chmi_desc",
        to: "/local/chmi",
        accent: TILE_ACCENTS.olive,
      },
      {
        id: "sverka",
        titleKey: "sverka_title",
        descKey: "elections_tile_sverka_desc",
        to: "/sverka",
        accent: TILE_ACCENTS.slate,
      },
      {
        id: "independents",
        titleKey: "local_national_independents",
        descKey: "elections_tile_independents_desc",
        to: `/local/${c}/independents`,
        accent: TILE_ACCENTS.moss,
        cycleScoped: true,
      },
      {
        id: "swing",
        titleKey: "local_leaderboard_swing",
        descKey: "elections_tile_swing_desc",
        to: `/local/${c}/swing`,
        accent: TILE_ACCENTS.copper,
        cycleScoped: true,
      },
    ],
  },
];

export const ELECTIONS_TILES: ElectionsTile[] = ELECTIONS_BANDS.flatMap(
  (b) => b.tiles,
);

/** Re-point a cycle-scoped destination at the cycle the reader actually selected.
 *
 *  ⚠ IT REPLACES ONLY THE CYCLE SEGMENT, and only on a path that already carries one. A blanket
 *  string replace would rewrite `/local/chmi` — whose second segment is a page, not a cycle —
 *  into a route that does not exist. A tile without `cycleScoped` is returned untouched, so the
 *  flag and this function are one decision rather than two. */
export const withLocalCycle = (to: string, cycle: string): string =>
  to.replace(
    new RegExp(`^/local/${LATEST_LOCAL_CYCLE}(?=/|$)`),
    `/local/${cycle}`,
  );
