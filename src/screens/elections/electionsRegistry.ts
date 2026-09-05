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
import { CYCLE_SURFACE, type ElectionsHubKind } from "./electionsHubCycle";
import { LATEST_PRESIDENTIAL_CYCLE } from "@/data/presidentialCatalogue";

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
  /**
   * Which KIND of cycle `to` embeds, when it embeds one at all — the screen re-resolves
   * that segment to the cycle the reader actually selected.
   *
   * ⚠ IT WAS A BOOLEAN AND COULD NOT STAY ONE. „This path embeds a cycle" says nothing
   * about WHICH catalogue's, so one rewrite would have to guess — and `withCycle` matches
   * the latest id of a named kind, so guessing wrong is a no-op that silently leaves the
   * reader on the latest cycle. Two kinds embed one today; the parliamentary tiles do not,
   * because `/parliamentary` carries the cycle in `?elections` rather than in the path.
   */
  cycleScoped?: Exclude<ElectionsHubKind, "parliamentary">;
}

export interface ElectionsBand {
  id: string;
  labelKey: string;
  descKey: string;
  tiles: ElectionsTile[];
}

const c = LATEST_LOCAL_CYCLE;

/**
 * The presidential results tile — BUILT AND WITHHELD.
 *
 * ⚠ IT IS NOT IN A BAND, and „empty `KINDS_WITHOUT_SURFACE` and it joins" was WRONG — a
 * first draft of this comment said so and it was measured false. Two things block it, and
 * `WITHHELD_TILES` records both so they are checked rather than remembered:
 *
 *   • its route does not exist (`/presidential/:cycle`, plan T5) — a tile must not seed a
 *     destination, the `dashboard-hub` rule this plan restates for the Tier 8 tile;
 *   • the results band is FULL. Four bands of four is a layout rule, not a preference: the
 *     grid is 4 columns at `xl`, so a fifth tile sits alone on its own row (§6.1). Placing
 *     it means deciding what leaves the band, and this step does not make that decision.
 *
 * What is NOT a blocker, because it was fixed here: the accent. It was `amber`, which
 * `runoffs` already holds on this page, and the accent rule is per PAGE rather than per
 * band — so the collision would have surfaced only on the run that shipped it.
 */
const PRESIDENTIAL_TILE: ElectionsTile = {
  id: "presidential",
  titleKey: "elections_tile_presidential",
  descKey: "elections_tile_presidential_desc",
  to: CYCLE_SURFACE.presidential.href(LATEST_PRESIDENTIAL_CYCLE),
  accent: TILE_ACCENTS.terracotta,
  cycleScoped: "presidential",
};

/** Why a built tile is not on the page. Each value is re-checked by the gate. */
export type TileBlocker = "route" | "band-full";

export type WithheldTile = {
  tile: ElectionsTile;
  /** ⚠ Not `ElectionsHubKind`: `"parliamentary"` embeds no cycle, so a tile could name a
   *  kind its own `to` cannot carry. It must equal `tile.cycleScoped`. */
  kind: Exclude<ElectionsHubKind, "parliamentary">;
  /** The band it is meant to join, once it can. */
  band: string;
  /**
   * What stands in the way.
   *
   * ⚠ EVERY ENTRY IS ASSERTED STILL TRUE by `electionsHubBands.test.ts`, so a blocker that
   * has been resolved turns the gate RED rather than sitting here as a stale excuse — the
   * „a stale exception fails too" shape this repo uses for its exhaustiveness sweeps. It is
   * what replaces three sentences that claimed the tile needed no further edit; measured,
   * it needed two.
   */
  blockers: TileBlocker[];
};

const GATED: WithheldTile[] = [
  {
    tile: PRESIDENTIAL_TILE,
    kind: "presidential",
    band: "results",
    blockers: ["route", "band-full"],
  },
];

/**
 * Tiles that exist and are not shown.
 *
 * ⚠ A SCENE WITH NO TILE HAS TWO CAUSES AND ONLY ONE IS A DEFECT. „Orphaned by a deletion"
 * and „built, waiting" are indistinguishable in an id-set difference, so they are named
 * here — and the gate checks each one is COMPLETE, so withholding cannot become a place to
 * park a half-built tile.
 */
export const WITHHELD_TILES: WithheldTile[] = GATED.filter(
  (w) => w.blockers.length > 0,
);

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
        cycleScoped: "local",
      },
      {
        id: "mayors-by-party",
        titleKey: "local_leaderboard_mayors_by_party",
        descKey: "elections_tile_mayors_by_party_desc",
        to: `/local/${c}/mayors-by-party`,
        accent: TILE_ACCENTS.rose,
        cycleScoped: "local",
      },
      {
        id: "council-votes",
        titleKey: "local_leaderboard_council_votes",
        descKey: "elections_tile_council_votes_desc",
        to: `/local/${c}/council-votes`,
        accent: TILE_ACCENTS.teal,
        cycleScoped: "local",
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
        cycleScoped: "local",
      },
      {
        id: "regions",
        titleKey: "local_all_regions",
        descKey: "elections_tile_regions_desc",
        to: `/local/${c}/regions`,
        accent: TILE_ACCENTS.azure,
        cycleScoped: "local",
      },
      {
        id: "runoffs",
        titleKey: "local_national_runoffs",
        descKey: "elections_tile_runoffs_desc",
        to: `/local/${c}/runoffs`,
        accent: TILE_ACCENTS.amber,
        cycleScoped: "local",
      },
      {
        id: "split-control",
        titleKey: "local_national_split_control",
        descKey: "elections_tile_split_control_desc",
        to: `/local/${c}/split-control`,
        accent: TILE_ACCENTS.plum,
        cycleScoped: "local",
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
        cycleScoped: "local",
      },
      {
        id: "closest-races",
        titleKey: "local_leaderboard_closest_races",
        descKey: "elections_tile_closest_races_desc",
        to: `/local/${c}/closest-races`,
        accent: TILE_ACCENTS.wine,
        cycleScoped: "local",
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
        cycleScoped: "local",
      },
      {
        id: "swing",
        titleKey: "local_leaderboard_swing",
        descKey: "elections_tile_swing_desc",
        to: `/local/${c}/swing`,
        accent: TILE_ACCENTS.copper,
        cycleScoped: "local",
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
/**
 * Each kind's newest cycle.
 *
 * ⚠ A RECORD RATHER THAN A TERNARY, so a fourth cycle-scoped kind is a compile error here.
 * `hubCycleHref`'s own comment states the rule: an implicit `else` gives a new kind the
 * presidential latest, and by this function's documented behaviour a wrong latest is a
 * silent NO-OP rather than an error.
 */
const LATEST_CYCLE: Record<
  Exclude<ElectionsHubKind, "parliamentary">,
  string
> = {
  local: LATEST_LOCAL_CYCLE,
  presidential: LATEST_PRESIDENTIAL_CYCLE,
};

const rx = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const withLocalCycle = (to: string, cycle: string): string =>
  withCycle(to, "local", cycle);

/**
 * Rewrite the cycle segment of a scoped destination.
 *
 * ⚠ IT MATCHES THE KIND'S OWN LATEST ID, which is what makes it safe on a path that has no
 * cycle: `/local/chmi` is the partial-elections feed and its second segment is a PAGE, so a
 * positional rewrite would send a reader to `/local/2019_10_27_mi` — a route that does not
 * exist. The `(?=/|$)` lookahead is the other half: without it a hypothetical
 * `/local/<latest>x` is half-rewritten into a path naming neither cycle.
 *
 * @param to - The tile's literal destination.
 * @param kind - Which catalogue's cycle the path embeds.
 * @param cycle - The cycle the reader resolved.
 * @returns The destination with its cycle segment replaced, or unchanged when it has none.
 */
export const withCycle = (
  to: string,
  kind: Exclude<ElectionsHubKind, "parliamentary">,
  cycle: string,
): string => {
  // ⚠ `href("")` IS THE KIND'S PREFIX, and only while `href` is `base + id`. If a kind ever
  // appended anything („/presidential/${id}/round-1") this yields „/presidential//round-1"
  // and the rewrite silently stops matching — the „marks exactly the destinations that
  // embed a cycle" gate is what fails then.
  const base = CYCLE_SURFACE[kind].href("");
  // ⚠ ESCAPED. Every id and prefix is metachar-free today, and a future one carrying „."
  // would change the pattern's meaning with no error — a non-matching pattern here is a
  // NO-OP, so the tile would quietly keep pointing at the latest cycle.
  return to.replace(
    new RegExp(`^${rx(base)}${rx(LATEST_CYCLE[kind])}(?=/|$)`),
    `${base}${cycle}`,
  );
};
