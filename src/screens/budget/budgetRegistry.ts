// The /budget hub registry — the single source of truth for the tiles the module
// fronts. Mirrors parliamentRegistry.ts / governanceRegistry.ts: pure data, the
// scene is referenced by `id` (BUDGET_SCENES[id]), so this module carries no JSX.
//
// Plan: docs/plans/budget-hub-v1.md §5 / T5.1. Fourteen destinations, four bands,
// fourteen distinct accents — all bands render together, so a repeated accent
// reads as „these two tiles are the same kind of thing".
//
// NO SEEDED TILES. Every `to` here is a static path: the module's one
// parameterised route, `/budget/ministry/:id`, is fronted by its PICKER
// (`/budget/ministries`), which is what T6.2 exists for. A tile pointing at a
// spending unit somebody else chose is the smell §4 names.
//
// BAND ORDER answers the reader's question, not the corpus's structure:
//
//   1. „Парите" — the four money pages. Where it comes from, where it goes,
//      how the year ended, what it was spent on. This is what a first-time
//      visitor came for.
//   2. „Кой харчи" — the institutions: the spending units, the drill-down, and
//      plan-against-outturn per unit.
//   3. „Как се решава" — the process: the eight key documents, and the
//      establishment behind the administration.
//   4. „Общините" — the municipal tier, which is a different level of
//      government and must not be mixed into the national bands.

import { TILE_ACCENTS } from "@/ux/infographic";

export interface BudgetTile {
  /** Scene key (BUDGET_SCENES) and the tile's stable identity. */
  id: string;
  titleKey: string;
  descKey: string;
  /** Absolute destination. Static — this module seeds nothing. */
  to: string;
  /** A TILE_ACCENTS token. Unique across the whole page. */
  accent: string;
}

export interface BudgetBand {
  labelKey: string;
  /** One line under the heading saying what a reader will find, in their terms.
   *  A heading names where you are; this says what is here. */
  descKey: string;
  tiles: BudgetTile[];
}

export const BUDGET_BANDS: BudgetBand[] = [
  {
    labelKey: "budget_band_money",
    descKey: "budget_band_money_desc",
    tiles: [
      {
        id: "revenue",
        titleKey: "budget_revenue_title",
        descKey: "budget_revenue_description",
        to: "/budget/revenue",
        accent: TILE_ACCENTS.emerald,
      },
      {
        id: "spending",
        titleKey: "budget_spending_title",
        descKey: "budget_spending_description",
        to: "/budget/spending",
        accent: TILE_ACCENTS.amber,
      },
      {
        id: "execution",
        titleKey: "budget_exec_title",
        descKey: "budget_exec_description",
        to: "/budget/execution",
        accent: TILE_ACCENTS.azure,
      },
      {
        id: "functional",
        titleKey: "budget_func_title",
        descKey: "budget_func_description",
        to: "/budget/functional",
        accent: TILE_ACCENTS.plum,
      },
    ],
  },
  {
    labelKey: "budget_band_who",
    descKey: "budget_band_who_desc",
    tiles: [
      {
        id: "units",
        titleKey: "budget_units_title",
        descKey: "budget_units_description",
        to: "/budget/ministries",
        accent: TILE_ACCENTS.indigo,
      },
      {
        id: "explorer",
        titleKey: "budget_explorer_title",
        descKey: "budget_explorer_description",
        to: "/budget/explorer",
        accent: TILE_ACCENTS.teal,
      },
      {
        id: "deviations",
        titleKey: "budget_dev_title",
        descKey: "budget_dev_description",
        to: "/budget/deviations",
        accent: TILE_ACCENTS.rose,
      },
      {
        id: "investments",
        titleKey: "budget_inv_title",
        descKey: "budget_inv_description",
        to: "/budget/investments",
        accent: TILE_ACCENTS.copper,
      },
    ],
  },
  {
    labelKey: "budget_band_process",
    descKey: "budget_band_process_desc",
    tiles: [
      {
        id: "law",
        titleKey: "budget_law_title",
        descKey: "budget_law_description",
        to: "/budget/law",
        accent: TILE_ACCENTS.slate,
      },
      {
        id: "personnel",
        titleKey: "budget_staff_title",
        descKey: "budget_staff_description",
        to: "/budget/personnel",
        accent: TILE_ACCENTS.steel,
      },
      {
        id: "funds",
        titleKey: "budget_funds_title",
        descKey: "budget_funds_description",
        to: "/budget/social-funds",
        accent: TILE_ACCENTS.aqua,
      },
    ],
  },
  {
    labelKey: "budget_band_municipal",
    descKey: "budget_band_municipal_desc",
    tiles: [
      {
        id: "municipal",
        titleKey: "budget_muni_title",
        descKey: "budget_muni_description",
        to: "/budget/municipal",
        accent: TILE_ACCENTS.wine,
      },
      {
        id: "muniInvestments",
        titleKey: "budget_ipop_title",
        descKey: "budget_ipop_description",
        to: "/budget/municipal/investments",
        accent: TILE_ACCENTS.clay,
      },
      {
        id: "muniCapital",
        titleKey: "budget_cap_title",
        descKey: "budget_cap_description",
        to: "/budget/municipal/capital",
        accent: TILE_ACCENTS.moss,
      },
    ],
  },
];

/** Flattened, for the gates and the screen. */
export const BUDGET_TILES: BudgetTile[] = BUDGET_BANDS.flatMap((b) => b.tiles);
