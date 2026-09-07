// The map slot's TYPED CONTRACT (Phase 2 item 4, §6).
//
// ⚠ THE ACCESSIBILITY RULE IS TWO PROPS THAT MUST TRAVEL TOGETHER, and the plan says why:
// `FeatureMap` derives keyboard access as `const keyboard = !!ariaLabel && !!onClick`, and
// `tabIndex`, `role="button"`, `aria-label`, `onKeyDown` and the focus ring are ALL gated on
// that one boolean. A region wired for selection but missing its `ariaLabel` is silently
// MOUSE-ONLY: nothing renders half-done and nothing looks wrong.
//
// So the pairing is enforced by the TYPE rather than by a check. An interactive panel's features
// each carry a required `ariaLabel` and the panel carries a required `onSelect`; a presentational
// one has neither and carries a single `ariaLabel` naming what the map shows. The third
// state — features that answer a mouse and not a keyboard — is the defect, and it is what an
// adapter produces by default if nobody states the posture. Here it is unrepresentable.

import type { FC } from "react";
import type {
  ElectionKind,
  ElectionPlaceLevel,
} from "@/data/elections/surfaceTypes";

/** One selectable feature. `ariaLabel` is REQUIRED — see the header. */
export type ElectionMapFeature = {
  /** The place code the feature stands for; also the key the ranked list selects by. */
  id: string;
  /** What a screen reader announces. Never optional: an unnamed selectable feature is the
   *  mouse-only defect. */
  ariaLabel: string;
  /** The quantity the choropleth colours by. Absent means "no value here" — never zero. */
  value?: number;
};

export type ElectionMapSlot =
  | {
      posture: "presentational";
      /** ⚠ ONE LABEL FOR THE WHOLE MAP, the posture `EuChoroplethMap` already takes. It is a
       *  legitimate answer for a map that illustrates rather than selects — and it is not a
       *  licence to skip the ranked list, which §4 requires regardless. */
      ariaLabel: string;
      features: readonly Omit<ElectionMapFeature, "ariaLabel">[];
    }
  | {
      posture: "interactive";
      /** ⚠ WHO DRIVES SELECTION — an ORTHOGONAL fact from the posture, and the one this union
       *  originally conflated with it. §6's two postures are a claim about the MAP's
       *  accessibility: does every selectable feature carry a label and an activation, or does
       *  the map illustrate rather than select. They say nothing about where the features come
       *  from, and the first adapter this shell wraps is an existing tile that fetches its own
       *  geography and navigates on click.
       *
       *  Forcing that tile into `"shell"` would mean handing it an empty feature list and a
       *  no-op `onSelect` — a lie in the type — while `"presentational"` would be a false
       *  a11y claim about a map that navigates. So the posture stays exactly the two §6 names
       *  and this second axis says who supplies the rows. */
      selection: "shell";
      features: readonly ElectionMapFeature[];
      /** Bound to the ranked list in BOTH directions (§6). */
      onSelect: (id: string) => void;
      selectedId?: string;
    }
  | {
      posture: "interactive";
      /** The adapter owns its own features, labels and navigation.
       *
       *  ⚠ THE POSTURE IS STILL A CLAIM AND STILL CHECKABLE — it is just checked where the
       *  features are, in the adapter's own gate, rather than at this boundary. The country
       *  adapter's map is keyboard-operable because `MapElement` now passes an `ariaLabel`
       *  through `FeatureMap`'s `!!ariaLabel && !!onClick` derivation, and
       *  `mapKeyboard.test.tsx` is what holds it. What must never happen is this variant
       *  becoming the place an unlabelled map hides: it asserts MORE than `presentational`,
       *  not less. */
      selection: "adapter";
    };

/** Which adapter draws a given surface's map. The key is the surface's own coordinates plus the
 *  map's declared mode, so a level with two modes gets two adapters rather than one with a
 *  branch inside it. */
export type ElectionMapAdapterKey =
  `${ElectionKind}/${ElectionPlaceLevel}/${string}`;

export const adapterKey = (
  kind: ElectionKind,
  level: ElectionPlaceLevel,
  mode: string,
): ElectionMapAdapterKey => `${kind}/${level}/${mode}`;

export type ElectionMapAdapterProps = ElectionMapSlot & {
  /** The question this map answers, already localised — §6 requires a map to name it. */
  question?: string;
  /** The place whose map this is — an oblast code, an obshtina code, an EKATTE.
   *
   *  ⚠ IT COMES FROM THE SURFACE, never from the router. A map adapter that read `useParams`
   *  would draw a different place from the one the ranked list beside it describes on any page
   *  that renders two surfaces — which §4.1's whole premise says is the expected case. */
  placeId: string;
  /** WHICH ELECTION this map colours — `2023_10_29_mi`, `2026_04_19`.
   *
   *  ⚠ IT COMES FROM THE SURFACE FOR THE SAME REASON `placeId` DOES, and here the alternative
   *  is worse than a router read: the local dashboards' own `useLocalAsOf()` resolves the cycle
   *  in effect at the SELECTED PARLIAMENTARY election, so an adapter defaulting to it would
   *  colour `/local/2019_10_27_mi` with 2023's result whenever the header's date sat after
   *  2023 — a full-country map of the wrong election, at a 200, beside a ranked list of the
   *  right one. */
  cycle: string;
  /** WHICH BALLOT of that election, when the level carries more than one (§2 decision 9).
   *
   *  ⚠ `local/country` DECLARES TWO SLOTS — mayor control and council support — that resolve to
   *  the SAME adapter key, because both declare `defaultMode: "winner"`. Without this the
   *  adapter cannot tell "how many mayoralties" from "how many votes", and those are different
   *  quantities with different denominators. Optional because a single-ballot level has nothing
   *  to disambiguate. */
  ballot?: string;
  /** WHICH ROUND of that ballot, where the level carries more than one.
   *
   *  ⚠ A PRESIDENTIAL PLACE ARTIFACT CARRIES TWO BALLOTS OF THE SAME KIND — one per round —
   *  and both declare a map. `ballot` cannot separate them (both are `presidential_ticket`), so
   *  without this an adapter colours the runoff canvas with round 1's leaders. The two are
   *  different electorates: nationally 5.7 points apart in 2021, and they name a different
   *  leader in whole oblasts. */
  round?: number;
};

/** ⚠ EVERY VALUE IS A LOADER, NEVER A COMPONENT. A static reference here would pull the
 *  adapter — and its map library — into this module's own chunk, which is exactly what the
 *  lazy indirection exists to prevent, and it would do so silently: the page still works, it
 *  just ships Leaflet to the section route.
 *
 *  ⚠ EMPTY IN PHASE 2 BY DESIGN. Phase 2's exit criterion is that every production page still
 *  renders its legacy composition, so wiring the eight real map tiles here would be the one
 *  change that breaks it. Phase 4 fills it; this file is the seam and its gates. */
export const MAP_ADAPTERS: Partial<
  Record<
    ElectionMapAdapterKey,
    () => Promise<{ default: FC<ElectionMapAdapterProps> }>
  >
> = {
  // The country's winner map — `RegionsMap`, wrapped. ⚠ `() => import(...)`, never a static
  // reference: the whole point of this registry is that the map libraries stay out of the
  // shell's own chunk, and a static import here would ship Leaflet and d3 to the polling-section
  // route, which draws no map at all.
  "parliamentary/country/winner": () =>
    import("./adapters/ParliamentaryCountryMap"),
  // ⚠ THE SAME MODULE FOR BOTH LEVELS (§Phase 4 item 6: "abroad uses the parliamentary region
  // adapter"). `MunicipalitiesMap` already branches on the region — МИР 32 loads the continents
  // geo, Sofia's three МИР load their районы — so a second entry pointing elsewhere would be a
  // second copy of that branching.
  "parliamentary/region/winner": () =>
    import("./adapters/ParliamentaryRegionMap"),
  "parliamentary/abroad/winner": () =>
    import("./adapters/ParliamentaryRegionMap"),
  "parliamentary/municipality/winner": () =>
    import("./adapters/ParliamentaryMunicipalityMap"),
  "parliamentary/settlement/winner": () =>
    import("./adapters/ParliamentarySettlementMap"),
  // The local country map — oblasts filled by the leading COUNCIL party.
  //
  // ⚠ ONE ENTRY FOR TWO DECLARED SLOTS. `local/country` declares a mayor-control map and a
  // council-support map, and both carry `defaultMode: "winner"`, so both resolve here; the
  // adapter branches on the `ballot` prop rather than on a key it cannot see. Only the council
  // ballot is generated today (`buildCountrySurface` emits one `municipal_council` ballot,
  // because a mayor "result" at this level is a COUNT of mayoralties and would print under
  // „Гласове"), so the mayor arm is reachable only if that changes.
  "local/country/winner": () => import("./adapters/LocalCountryMap"),
  // The oblast's municipalities. ⚠ TWO DECLARED SLOTS RESOLVE HERE — mayor control and council
  // support — because both carry `defaultMode: "winner"`; `LocalRegionMap` branches on the
  // `ballot` prop. It costs no data fetch: the region rollup it colours by is the file the
  // region dashboard already loads for its tables.
  "local/region/winner": () => import("./adapters/LocalRegionMap"),
  // ⚠⚠ NO `local/municipality` ENTRY, AND IT IS A CORPUS MEASUREMENT RATHER THAN A DESIGN
  // CHOICE. That level's one map slot is the MAYOR ballot at `section` grain — a per-station
  // marker map — and the stations have no coordinates to plot. `LocalSectionResult.longitude`
  // is backfilled from the parliamentary section archive
  // (`scripts/parsers_local/backfill_local_section_coords.ts`), and measured 2026-09-07 across
  // the committed 2023 corpus: **0 of 289 município shards carry a single coordinate** — and
  // the same is true of the LIVE bucket copy, checked directly rather than inferred from the
  // local tree.
  //
  // So `LocalMunicipalityMap` exists, is correct, and self-hides everywhere. Registering it
  // would put „Как е гласувано за кмет по секции?" over an empty slot on all 289 municipality
  // pages — a question the page asks and cannot answer, which is worse than the „картата не е
  // налична" line an unregistered key renders. Register it in the same change that backfills
  // the coordinates, not before; the adapter is ready and the gate below will notice.
  // ⚠⚠ NO `local/settlement` ENTRY, AND IT IS A DATA REFUSAL RATHER THAN AN OMISSION.
  //
  // That level declares ONE ballot — `settlement_mayor`, the кметство's own mayoral contest —
  // and its map slot names that ballot at `section` grain. The corpus carries no such
  // breakdown: `LocalSectionResult` has `partyVotes` (общински съвет), `mayorVotes` (КО, the
  // MUNICÍPIO mayor) and `rayonMayorVotes` (КР, a район mayor), and nothing for КК. Verified
  // against the committed shards, not inferred from the type: a 2023 section carries exactly
  // `partyVotes` / `mayorVotes` and no fourth vote array.
  //
  // So the only thing a map here COULD be filled with is the parent município's mayoral race,
  // under a heading that says settlement mayor — which is precisely what this level's own
  // descriptor forbids („a settlement surface must never attribute a parent council as a
  // settlement office"). A wrong map is worse than none; the ranked result beside it is the
  // text equivalent §4 requires either way, and `ElectionMapPanel` says „картата не е налична"
  // rather than drawing somebody else's election.
  // The presidential place maps — the oblast's municipalities and the município's settlements.
  //
  // ⚠⚠ THIS WAS A MEASURED REFUSAL AND THE MEASUREMENT HAS BEEN RE-TAKEN, NOT WAIVED. The
  // argument against it was that a choropleth needs its CHILDREN's results and the presidential
  // tree has no per-place shards: below the country each level is ONE file per round covering
  // the whole country, which is exactly why those levels are `artifact` in `SURFACE_POLICY`.
  // That is still true. What changed is that the numbers it was argued from were RAW bytes:
  //
  //     level        file                       raw        gzipped   entries
  //     region    →  municipality_votes.json    0.96 MB     47 KB      272
  //     município →  settlement_votes.json     14.63 MB    346 KB    4,184
  //
  // ⚠ AND THE BUCKET SERVES RAW BY DEFAULT, so the raw column is what a reader pays unless the
  // path is on `scripts/bucket_gzip.ts`'s hot list. Verified live rather than assumed: GCS
  // answers `x-goog-stored-content-encoding: identity` for a data object that is not on it, and
  // `gzip` for one that is — `gsutil rsync -j` is TRANSPORT encoding and stores identity, which
  // that script's own header records. The presidential `tur*/` roll-ups are on the list now.
  //
  // ⚠ SO THE REGISTRATION AND THE GZIP LIST ARE ONE CHANGE. Dropping those paths from
  // `bucket_gzip.ts` turns the município map into a 14.6 MB download with nothing failing —
  // unregister the adapter rather than leave it to ship that. The PARSE was measured too and is
  // not the constraint: 19 ms for the settlement file on a laptop, ~54 MB heap.
  //
  // Sharding the roll-ups per parent is still the better shape and is still unbuilt: it would
  // mint ~5,300 objects against a corpus at 58,915, which is a coverage decision with its own
  // arithmetic rather than something to slip in behind a map.
  "presidential/region/winner": () =>
    import("./adapters/PresidentialRegionMap"),
  "presidential/municipality/winner": () =>
    import("./adapters/PresidentialMunicipalityMap"),
  //
  // ⚠ NO `presidential/settlement` ENTRY. Its declared grain is `section`, and the file that
  // would fill it is `tur<r>/sections/<oblast>.json` — 2.4 MB raw / 62 KB gzipped for Бургас,
  // servable — but the SECTION level is where the object-count argument bites hardest (~60,000
  // of the presidential share) and the map would be markers rather than a choropleth, which is
  // a different component from the two above. Left for the tier that ships the section pages.
  //
  // ⚠ `abroad` IS STILL UNREGISTERED, for a reason that is not about size. Its 241.3 KB file IS
  // servable and the geo is the continents one the parliamentary МИР-32 adapter already loads.
  // What is missing is the JOIN: this tree keys abroad by ISO-2 COUNTRY while that geo's
  // features are continents, so there is no crosswalk to colour by without inventing one —
  // work with its own decisions (which continent holds a section whose country the corpus
  // cannot name?), not a registry line.
};
