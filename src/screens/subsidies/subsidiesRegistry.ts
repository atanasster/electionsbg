// The /subsidies hub registry — the single source of truth for the tiles the module fronts.
// Mirrors fundsRegistry.ts / governanceRegistry.ts: pure data, the scene is referenced by `id`
// (SUBSIDIES_SCENES[id]), so this module carries no JSX.
//
// Four bands, 13 tiles, 13 distinct accents (docs/plans/subsidies-hub-v1.md §4).
// 4 / 3 / 4 / 2 — the grid is four columns at xl, so no band strands a tile alone on a second
// row. Bands are named for the question they answer, never „Още".
//
// NO SEEDED TILES. Every `to` below is static, and all thirteen were grepped in routes.tsx.
// `/farm/:eik` is parameterised and is therefore NOT a tile: its entry point is the live search
// box above this grid. A tile carrying a generator-chosen id lands the reader on somebody else's
// subject and omits itself entirely whenever the generator returns nothing.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// BAND 3 IS A DIFFERENT KIND OF THING FROM BANDS 1, 2 AND 4, and the difference is the whole
// reason it is a separate band rather than four more tiles.
//
// Bands 1/2/4 are THIS corpus — ДФ „Земеделие" payments, scope-keyed, every figure from the one
// `agri_hub_stats` call and re-read on the destination page. Band 3 is four OTHER public-subsidy
// streams on their own cadences, so every one of its tiles NAMES ITS PERIOD in the caption.
// They are shown together because „кой получава държавни пари" is the question, and answering
// it with farm subsidy alone would imply that is the whole of it.
//
// „Names its period", not „is annual" — three of the four are a single year (municipal 2026,
// rail 2025, party a dated run-rate) and the film figure is the НФЦ register's twelve-year
// cumulative unless the reader has pinned a year, which is what /culture itself shows. An
// earlier draft of this header called all four annual; the film tile sat 7-11x above the
// stream it represented, under a heading asserting the four were comparable.
//
// ⚠️ THE FOUR ARE NEVER SUMMED, and the band's description says so. They are on different bases
// (paid vs budgeted vs contracted), different perimeters and different years; a total across them
// would be a number describing nothing. The same rule governs /subsidies/cross-programme's three
// columns, for the same reason.
//
// ⚠️ THE КФП „Субсидии" BUDGET LINE IS DELIBERATELY NOT A TILE, though it measures €965.7m. It is
// not a distinct stream — it is a budget AGGREGATE already containing the national agriculture
// top-up, the energy subsidies and part of the СОЕ transport money, so putting it beside four
// registers of identifiable recipients invites exactly the summation the band forbids. It stays
// one click away: the band description links /budget/spending in prose.
// ═══════════════════════════════════════════════════════════════════════════════════════════

import { TILE_ACCENTS } from "@/ux/infographic";

export interface SubsidiesTile {
  /** Scene key (SUBSIDIES_SCENES) and the tile's stable identity. Also the key
   *  `tileMetric` switches on, so renaming one without the other silently drops
   *  the tile's figure rather than failing. */
  id: string;
  titleKey: string;
  descKey: string;
  /** Absolute destination. Always static — see the header on why there are no seeds. */
  to: string;
  /** A TILE_ACCENTS token. Unique across the whole page: all four bands render together, so a
   *  repeat reads as „these two tiles are the same kind of thing". */
  accent: string;
}

export interface SubsidiesBand {
  labelKey: string;
  /** One line under the heading saying what is in the band. A heading names where you are;
   *  this says what you will find. */
  descKey: string;
  tiles: SubsidiesTile[];
}

export const SUBSIDIES_BANDS: SubsidiesBand[] = [
  {
    // „Кой получава парите" — the question people actually type. Recipients first, then the
    // three ways of slicing them, then the honest caveat that ~40% of the money cannot be
    // attributed to anyone at all. That last tile sits in band 1 rather than band 4 on purpose:
    // it is a fact about the recipients, not about the data pipeline, and burying it under
    // „Данните" would let a reader take the three tiles beside it as complete.
    labelKey: "subsidies_band_recipients",
    descKey: "subsidies_band_recipients_desc",
    tiles: [
      {
        id: "recipients",
        titleKey: "subsidies_tile_recipients",
        descKey: "subsidies_tile_recipients_desc",
        to: "/subsidies/recipients",
        accent: TILE_ACCENTS.clay,
      },
      {
        id: "schemes",
        titleKey: "subsidies_tile_schemes",
        descKey: "subsidies_tile_schemes_desc",
        to: "/subsidies/schemes",
        accent: TILE_ACCENTS.olive,
      },
      {
        id: "places",
        titleKey: "subsidies_tile_places",
        descKey: "subsidies_tile_places_desc",
        to: "/subsidies/places",
        accent: TILE_ACCENTS.moss,
      },
      {
        id: "untraceable",
        titleKey: "subsidies_tile_untraceable",
        descKey: "subsidies_tile_untraceable_desc",
        to: "/subsidies/untraceable",
        accent: TILE_ACCENTS.amber,
      },
    ],
  },
  {
    // „Концентрация и връзки", never „Още" — a band called „Още" announces only that the band
    // above it mattered more, so everything under it reads as offcuts. These three are the half
    // of the module people share.
    labelKey: "subsidies_band_concentration",
    descKey: "subsidies_band_concentration_desc",
    tiles: [
      {
        id: "concentration",
        titleKey: "subsidies_tile_concentration",
        descKey: "subsidies_tile_concentration_desc",
        to: "/subsidies/concentration",
        accent: TILE_ACCENTS.brass,
      },
      {
        id: "political",
        titleKey: "subsidies_tile_political",
        descKey: "subsidies_tile_political_desc",
        to: "/subsidies/political",
        accent: TILE_ACCENTS.plum,
      },
      {
        id: "crossProgramme",
        titleKey: "subsidies_tile_cross_programme",
        descKey: "subsidies_tile_cross_programme_desc",
        to: "/subsidies/cross-programme",
        accent: TILE_ACCENTS.aqua,
      },
    ],
  },
  {
    // BAND 3 — the other streams. See the header: annual, never summed, each names its year.
    labelKey: "subsidies_band_other",
    descKey: "subsidies_band_other_desc",
    tiles: [
      {
        id: "municipal",
        titleKey: "subsidies_tile_municipal",
        descKey: "subsidies_tile_municipal_desc",
        to: "/budget/municipal",
        accent: TILE_ACCENTS.ochre,
      },
      {
        id: "rail",
        // ⚠️ /sector/transport, NOT /sector/transport#rail-subsidy. The section HAS that id and
        // the anchor is tempting — but three /funds KPI cards once targeted #top-beneficiaries,
        // #money-flow and #absorption, a later rework moved all three onto their own pages, and
        // every one of those links silently did nothing when clicked. A same-page anchor is the
        // link that rots when the destination is reorganised, and nothing type-checks it.
        titleKey: "subsidies_tile_rail",
        descKey: "subsidies_tile_rail_desc",
        to: "/sector/transport",
        accent: TILE_ACCENTS.steel,
      },
      {
        id: "film",
        titleKey: "subsidies_tile_film",
        descKey: "subsidies_tile_film_desc",
        to: "/culture",
        accent: TILE_ACCENTS.rose,
      },
      {
        // ⚠️ THIS POINTS AT A SIMULATOR, and that is a known weakness rather than an oversight.
        // PARTY_SUBSIDY_VOTES / PARTY_SUBSIDY_RATE_EUR have exactly one consumer in the repo —
        // BudgetPolicySimulator — and /financing is the Сметна палата corpus of PRIVATE
        // donations, which renders no state subsidy at all and would be the wrong destination.
        // So the reader lands on a budget lever, not on „кой колко получи". The caption says
        // „годишен таван по ЗПП" rather than implying a register; the per-party breakdown is
        // derivable (party-list votes × €3.00) and is recorded as future work in the plan's
        // §13.3, at which point this `to` becomes /financing/subsidy.
        id: "party",
        titleKey: "subsidies_tile_party",
        descKey: "subsidies_tile_party_desc",
        to: "/budget/simulator",
        accent: TILE_ACCENTS.indigo,
      },
    ],
  },
  {
    // „Данните" — the browse and the coverage note. Last because it answers „can I check this
    // myself", which is the question that comes after the others, not before.
    labelKey: "subsidies_band_data",
    descKey: "subsidies_band_data_desc",
    tiles: [
      {
        id: "browse",
        titleKey: "subsidies_tile_browse",
        descKey: "subsidies_tile_browse_desc",
        to: "/subsidies/browse",
        accent: TILE_ACCENTS.slate,
      },
      {
        id: "coverage",
        titleKey: "subsidies_tile_coverage",
        descKey: "subsidies_tile_coverage_desc",
        to: "/subsidies/coverage",
        accent: TILE_ACCENTS.copper,
      },
    ],
  },
];

/** Every i18n key the SCREEN's `tileMetric` passes to `t()` for a metric caption.
 *
 *  It lives here rather than beside the switch that uses it for two reasons. Exporting a
 *  constant from `SubsidiesDashboardScreen.tsx` costs fast refresh on the whole screen — the
 *  same hazard that split `useAgriScope.ts` out of `AgriScopeGate.tsx`. And the gate that needs
 *  it (`subsidiesRegistry.test.ts`) derives every other key from this file, so a key list
 *  somewhere else is a list that gets forgotten: these nine were ungated on their first cut,
 *  and a rename would have printed „subsidies_m_firms" at the reader with every test green.
 *
 *  Not a per-tile field, because the mapping is not one-to-one — „По област" captions with the
 *  oblast's NAME, and the four band-3 tiles compose their caption from a period. */
export const SUBSIDIES_METRIC_KEYS = [
  "subsidies_m_firms",
  "subsidies_m_schemes",
  "subsidies_m_top_oblast",
  "subsidies_m_no_eik",
  "subsidies_m_top100",
  "subsidies_m_linked",
  "subsidies_m_also_isun",
  "subsidies_m_payments",
  "subsidies_m_years_covered",
] as const;
