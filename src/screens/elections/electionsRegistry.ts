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
// cycle-scoped tile carries the KIND of cycle its path embeds, and the screen substitutes the
// cycle the reader resolved for that kind. `withCycle` is that rewrite, and it lives beside the
// `cycleScoped` flag so the two cannot drift. `withLocalCycle` is a convenience alias with no
// production call site, retained for the local-only tests.
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
 * How many tiles a band holds.
 *
 * ⚠ A LAYOUT RULE, NOT A PREFERENCE: the grid is 4 columns at `xl`, so a fifth tile sits alone
 * on its own row. It is exported because `electionsHubBands.test.ts` states the same rule twice
 * — the per-band length and the `band-full` blocker — and a grid that moved to 5 columns with
 * only one of them updated would report `band-full` for a band that has room.
 */
export const TILES_PER_BAND = 4;

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
   * „a stale exception fails too" shape this repo uses for its exhaustiveness sweeps.
   */
  blockers: TileBlocker[];
};

/**
 * Tiles that are built and not on the page.
 *
 * ⚠ EMPTY IS THE CORRECT STATE, NOT A LEFTOVER. The presidential tile sat here from plan
 * T4.4 until 2026-09-07, blocked by `band-full`: the results band was one parliamentary tile
 * and three LOCAL ones against a four-column `xl` grid, so seating it meant deciding what
 * leaves — which the registry could not decide for itself. That decision is made below.
 *
 * ⚠ THE MACHINERY STAYS because it is the seam a fourth kind arrives through, and because an
 * empty list makes the gate's loop VACUOUS — so `electionsHubBands.test.ts` exercises the
 * blocker recompute against a synthetic entry instead of against whatever happens to be
 * parked here. Deleting the type would take that check with it.
 */
const GATED: WithheldTile[] = [];

export const WITHHELD_TILES: WithheldTile[] = GATED.filter(
  (w) => w.blockers.length > 0,
);

/**
 * ⚠ THE FIRST BAND IS ONE TILE PER KIND OF VOTE — parliamentary, presidential, local, and the
 * partial elections between cycles — which is what makes room for a third catalogue without a
 * fifth band. The two national leaderboards it used to carry (`mayors-by-party`,
 * `council-votes`) moved to `rankings`, which is what they always were.
 *
 * ⚠ `independents` LEFT THE PAGE for the seventeenth slot, and nothing became unreachable:
 * `/local/:cycle/independents` is still routed, still linked from `LocalCountryDashboardCards`
 * on the local cycle page and from the header menu, and still carries a crawlable link in the
 * `/elections` prerendered body.
 *
 * ⚠ IT IS NOT PRERENDERED AND HAS NO SITEMAP `<loc>`, and a first draft of this comment claimed
 * both. No member of the `LocalMunicipalityListScreen` family is: `enumerateLocalMunicipalities`
 * emits one entry per obshtinaCode and can never emit a list segment. That makes the crawlable
 * link in `ELECTIONS_HUB_SECTIONS` load-bearing rather than decorative — it is the page's only
 * crawler-reachable entry outside the local cycle page, so do not drop it as "covered anyway".
 *
 * `TILES_PER_BAND` above is why there were only sixteen slots to begin with.
 */
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
        // ⚠ `terracotta` AND NOT `amber`: the accent rule is per PAGE rather than per band,
        // and `runoffs` holds amber one band down. The collision this tile shipped with in
        // draft would have surfaced only on the run that placed it.
        id: "presidential",
        titleKey: "elections_tile_presidential",
        descKey: "elections_tile_presidential_desc",
        to: CYCLE_SURFACE.presidential.href(LATEST_PRESIDENTIAL_CYCLE),
        accent: TILE_ACCENTS.terracotta,
        cycleScoped: "presidential",
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
        // ⚠ NOT `cycleScoped`: `/local/chmi`'s second segment is a PAGE, not a cycle, and the
        // feed is cross-cycle by construction — every partial election since 2024, not the
        // selected cycle's.
        id: "chmi",
        titleKey: "chmi_feed_title",
        descKey: "elections_tile_chmi_desc",
        to: "/local/chmi",
        accent: TILE_ACCENTS.olive,
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
    id: "rankings",
    labelKey: "elections_band_rankings",
    descKey: "elections_band_rankings_desc",
    tiles: [
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
        id: "swing",
        titleKey: "local_leaderboard_swing",
        descKey: "elections_tile_swing_desc",
        to: `/local/${c}/swing`,
        accent: TILE_ACCENTS.copper,
        cycleScoped: "local",
      },
      {
        id: "sverka",
        titleKey: "sverka_title",
        descKey: "elections_tile_sverka_desc",
        to: "/sverka",
        accent: TILE_ACCENTS.slate,
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
  // ⚠ THE DECLARED PREFIX, NOT `href("")`. That idiom held only while a kind's URL was exactly
  // `prefix + id`, and it broke the day the presidential row started building through
  // `presidentialUrl` — which refuses an empty id, so `href("")` returned `null` and this line
  // threw. `CYCLE_SURFACE[kind].prefix` is declared beside `href` and gated against it.
  const base = CYCLE_SURFACE[kind].prefix;
  // ⚠ ESCAPED. Every id and prefix is metachar-free today, and a future one carrying „."
  // would change the pattern's meaning with no error — a non-matching pattern here is a
  // NO-OP, so the tile would quietly keep pointing at the latest cycle.
  return to.replace(
    new RegExp(`^${rx(base)}${rx(LATEST_CYCLE[kind])}(?=/|$)`),
    `${base}${cycle}`,
  );
};
