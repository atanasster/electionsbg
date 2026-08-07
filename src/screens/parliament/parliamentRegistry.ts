// The /parliament (Народно събрание) hub registry — the single source of truth for the
// tiles the module fronts. Mirrors governanceRegistry.ts / sectorRegistry.ts: pure data,
// the scene is referenced by `id` (PARLIAMENT_SCENES[id]), so this module carries no JSX.
//
// Three bands, 11 tiles, 11 distinct accents (docs/plans/parliament-hub-v1.md §4.5).
// Ordering is the plan's §4.3: look-up beats read, which the measured traffic in §2.7
// confirms rather than assumes — the record pages out-earn the dashboards, and
// /parliament/embedding out-earns cohesion and attendance combined from the LAST tile
// slot on the hub this replaces.
//
// SEEDED TILES. Two band-4 destinations are parameterised routes with no static landing
// (`/parliament/similarity/:mpId`, `/votes/between/:pair`). Writing the pattern as `to`
// would satisfy an "absolute destination" assertion while linking nowhere, so an entry
// whose `to` carries a `:` segment MUST also carry a `seed`, and the screen substitutes
// the value the hub blob resolved. A tile whose seed is unavailable is OMITTED rather
// than rendered with a broken href — an absent tile is honest, a dead link is not.

import { TILE_ACCENTS } from "@/ux/infographic";

/** Which resolved value fills a parameterised `to`. Both come from small precomputed
 *  artifacts the hub already reads, never from a full aggregate. */
export type ParliamentSeed = "similarity" | "pair";

export interface ParliamentTile {
  /** Scene key (PARLIAMENT_SCENES) and the tile's stable identity. */
  id: string;
  titleKey: string;
  descKey: string;
  /** Absolute destination. May contain one `:param` segment — then `seed` is required. */
  to: string;
  /** Present iff `to` is parameterised. Names the blob field that fills it. */
  seed?: ParliamentSeed;
  /** A TILE_ACCENTS token. Unique across the whole page — all three bands render together. */
  accent: string;
}

export interface ParliamentBand {
  labelKey: string;
  /** One line under the heading saying what is in the band. A heading names where you are;
   *  this says what you will find — „В залата" alone is a location, not a table of
   *  contents. */
  descKey: string;
  tiles: ParliamentTile[];
}

export const PARLIAMENT_BANDS: ParliamentBand[] = [
  {
    // BANDS ARE NAMED FOR WHAT IS IN THEM, not for their rank.
    //
    // FOUR / THREE / FOUR, and the counts are not incidental: the grid is four columns at
    // xl, so a five-tile band leaves one orphan on its own row. That is what the first cut
    // of this regrouping did by putting the roster with the declarations.
    //
    // The first two used to read „Разгледай" and „Още" — an instruction and a leftover,
    // neither of which says what is inside. „Още" was the worse: it announced only that the
    // band above it mattered more, so attendance and both similarity views read as offcuts
    // rather than as the answer to „кой с кого гласува". The third heading was always fine
    // and is unchanged, and it now pairs with the first: what happens IN the chamber, then
    // what the members do outside it.
    //
    // Ordering WITHIN a band is still by measured demand (§2.7) — that part was right.
    labelKey: "nsh_band_chamber",
    descKey: "nsh_band_chamber_desc",
    tiles: [
      {
        // The records. §2.7: 107 views across 51 distinct paths, engagement 15.6% ABOVE
        // the site average — the only half of this module that is above it.
        id: "votes",
        titleKey: "nsh_tile_votes",
        descKey: "nsh_tile_votes_desc",
        to: "/votes",
        accent: TILE_ACCENTS.plum,
      },
      {
        // Who turned up. Moved here from „Още": presence is a fact about the sitting, and
        // it sat under a heading that implied it was an afterthought.
        id: "attendance",
        titleKey: "nsh_tile_attendance",
        descKey: "nsh_tile_attendance_desc",
        to: "/parliament/attendance",
        accent: TILE_ACCENTS.amber,
      },
      {
        id: "cohesion",
        titleKey: "nsh_tile_cohesion",
        descKey: "nsh_tile_cohesion_desc",
        to: "/parliament/cohesion",
        accent: TILE_ACCENTS.teal,
      },
      {
        // Who sits there. NOT NS-scoped and cannot be — person_role rows for `mp` carry
        // ref = mpId with no term column, so it lands on every MP since the 44th (2,120
        // people) rather than the 240 seated, which is why the tile carries no figure.
        id: "mps",
        titleKey: "nsh_tile_mps",
        descKey: "nsh_tile_mps_desc",
        to: "/persons?role=mp",
        accent: TILE_ACCENTS.clay,
      },
    ],
  },
  {
    // Band 4 — alignment. Разцепления is deliberately ABSENT: `grep dissent src/routes.tsx`
    // returns nothing, so it has no destination. It stays a band-2 news card (H2), where
    // it needs none, and returns as a tile if /parliament/dissents is ever built.
    labelKey: "nsh_band_alignment",
    descKey: "nsh_band_alignment_desc",
    tiles: [
      {
        // Split out of /votes, which is an archive and had grown an analysis above its
        // table. It is the group-level answer to this band's question, where the three
        // beside it are the member-level ones.
        id: "correlation",
        titleKey: "nsh_tile_correlation",
        descKey: "nsh_tile_correlation_desc",
        to: "/parliament/correlation",
        accent: TILE_ACCENTS.olive,
      },
      {
        // Promoted from the long tail: 21 views at 1m01s, earned from the LAST tile
        // position on the previous hub — the one traffic signal that survives the
        // objection that this distribution merely measures what the hub links to.
        id: "embedding",
        titleKey: "nsh_tile_embedding",
        descKey: "nsh_tile_embedding_desc",
        to: "/parliament/embedding",
        accent: TILE_ACCENTS.indigo,
      },
      {
        id: "similarity",
        titleKey: "nsh_tile_similarity",
        descKey: "nsh_tile_similarity_desc",
        // The PICKER, not a seeded member. It used to point at
        // /parliament/similarity/:mpId with a seed the generator chose, so a reader landed
        // on a stranger's ranking and the tile omitted itself entirely whenever the seed
        // was missing. The page now opens on a chooser and keeps it on screen.
        to: "/parliament/similarity",
        accent: TILE_ACCENTS.aqua,
      },
      {
        id: "pair",
        titleKey: "nsh_tile_pair",
        descKey: "nsh_tile_pair_desc",
        // The PICKER. Same change as the similarity tile, same reason: it pointed at a
        // generator-chosen pair, so the reader landed on two groups somebody else picked.
        to: "/votes/between",
        accent: TILE_ACCENTS.terracotta,
      },
    ],
  },
  {
    // Band 5 — Депутатите извън залата. Pure linking, no new data: these registers belong
    // to the Сметна палата and the Търговски регистър, not the NS, so the module promotes
    // the link rather than claiming the ownership. This band is what makes /parliament a
    // module rather than a vote-analytics silo.
    labelKey: "nsh_band_people",
    descKey: "nsh_band_people_desc",
    tiles: [
      {
        id: "declarations",
        titleKey: "nsh_tile_declarations",
        descKey: "nsh_tile_declarations_desc",
        to: "/governance/declarations",
        accent: TILE_ACCENTS.rose,
      },
      {
        id: "assets",
        titleKey: "nsh_tile_assets",
        descKey: "nsh_tile_assets_desc",
        to: "/mp-assets",
        accent: TILE_ACCENTS.gold,
      },
      {
        id: "companies",
        titleKey: "nsh_tile_companies",
        descKey: "nsh_tile_companies_desc",
        to: "/mp/companies",
        accent: TILE_ACCENTS.moss,
      },
      {
        id: "connections",
        titleKey: "nsh_tile_connections",
        descKey: "nsh_tile_connections_desc",
        to: "/connections",
        accent: TILE_ACCENTS.steel,
      },
    ],
  },
];

/** Flat view — the gates and the screen both want one list rather than three. */
export const PARLIAMENT_TILES: ParliamentTile[] = PARLIAMENT_BANDS.flatMap(
  (b) => b.tiles,
);

/** True when `to` carries a `:param` segment and therefore needs a seed to resolve. */
export const isSeededDestination = (to: string): boolean =>
  to.split("/").some((segment) => segment.startsWith(":"));

/** Substitute the seed into a parameterised `to`. Returns null when the seed is missing or
 *  empty, which is the signal to OMIT the tile rather than render a dead link. */
export const resolveDestination = (
  tile: ParliamentTile,
  seeds: Partial<Record<ParliamentSeed, string | undefined>>,
): string | null => {
  if (!isSeededDestination(tile.to)) return tile.to;
  if (!tile.seed) return null;
  const value = seeds[tile.seed];
  if (!value) return null;
  // The FUNCTION form of replace, not the string form: a string replacement treats `$&`,
  // `$1` and friends as backreferences, so a seed containing one would splice the matched
  // `:pair` back into the href. encodeURIComponent shields today's seeds, but the shield
  // is incidental — the callers are free to change.
  return tile.to.replace(/:[A-Za-z]+/, () => value);
};
