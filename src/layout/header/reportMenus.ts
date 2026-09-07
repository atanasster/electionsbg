// Header dropdowns match the three-dashboard architecture (Elections home,
// Local-elections home, Governance home):
//
//   electionsMenu   — ALL THREE electoral systems, merged: the parliamentary
//                     country result and its analyses/reports hubs, the
//                     presidential cycle, the local mayor/council leaderboards
//                     and município lists, the extraordinary elections and the
//                     officials-vs-ЦИК reconciliation. Four groups, reading the
//                     same heading keys as the `/elections` hub's bands — so a
//                     band that is renamed or re-seated has to be answered here
//                     too, which `menuCopy.test.ts` now enforces rather than
//                     leaving to memory (a deleted band key rendered as raw
//                     ASCII in the global nav until it did).
//   governanceMenu  — budget & spending, parliament, MP declarations,
//                     indicators & context; the long-running pillars that
//                     span parliament terms.
//
// Each top-level menu groups leaf links under section headers. A header is a
// `group: true` MenuItem whose `subMenu` holds the group's links. The renderer
// adapts the same data to two layouts:
//
//   Desktop — the panel stays *flat*: a group renders as a non-clickable
//     DropdownMenuLabel followed by its links inline, so every leaf is one
//     open away with no nested fly-out to hover. (The reports matrix is the
//     one genuine nested fly-out — it has no `group` flag.)
//   Mobile — a group renders as a collapsible accordion, so an expanded
//     section shows just its handful of group headers instead of every leaf
//     at once. This keeps the hamburger tree short however many links a
//     section accumulates.
//
// Both trees share the same MenuItem shape so Header.tsx's recursive
// RenderMenuItem walks them with identical logic — only the data differs.
// `mobileOnly` items (the section "Overview" home links) surface only in the
// mobile tree — on desktop the split-button title already links to the
// section dashboard, so they'd be redundant there.

import { LATEST_PRESIDENTIAL_CYCLE } from "@/data/presidentialCatalogue";
import { presidentialUrl } from "@/data/elections/presidentialRoutes";
import { LATEST_LOCAL_CYCLE } from "@/data/local/useLatestLocalCycle";

export type MenuItem = {
  title: string;
  link?: string;
  subMenu?: MenuItem[];
  // A section header: its `subMenu` is rendered flat (label + inline links) on
  // desktop and as a collapsible accordion on mobile. Without this flag a
  // `subMenu` is a true nested menu (fly-out on desktop, e.g. the reports
  // matrix).
  group?: boolean;
  category?: "financials" | "recount" | "preferences" | "suemg";
  // Rendered only inside the mobile hamburger tree. Used for the section
  // "Overview" home link, which the desktop split-button title supplies.
  mobileOnly?: boolean;
  // Rendered only in the dev build (`import.meta.env.DEV`). For entries whose
  // page is itself dev-gated because its data is bucket-synced but not yet
  // shipped to production — a prod link would 404. Drop the flag here and on the
  // matching <Route> once `npm run bucket:sync` has shipped the data.
  devOnly?: boolean;
  // Desktop only, top-level menus: lay the section groups out in this many
  // columns instead of one tall single-column list. Set on menus with enough
  // groups to otherwise run the full viewport height (e.g. governance's four
  // sections). The mobile accordion tree ignores it.
  columns?: number;
};

// Top-nav links pin the latest regular cycle; once on a local page the date
// selector lets the visitor switch to an earlier cycle.
const c = LATEST_LOCAL_CYCLE;

// ⚠ ONE ELECTIONS MENU, MERGED FROM TWO (Phase 3 item 6). „Избори" and „Местни избори" were
// separate top-level items, which put the two halves of one subject in two dropdowns and made
// the reader decide which system their question belonged to before they could ask it. The
// groups here are the same four the `/elections` hub's bands use, and they read the SAME
// heading keys, so the menu and the hub cannot disagree about what the sections are.
//
// Two things this merge DECIDES rather than leaves to omission:
//
//   • THE ROOT LEAF IS GONE and stays gone. `/` is the global home, reached through the logo;
//     a menu entry labelled „Избори" that opens it is a link to the wrong page that navigates
//     perfectly. `electionsMenu.test.ts` holds it.
//   • THE LEAVES ARE EXACTLY THE HUB'S SIXTEEN TILES — no more and no fewer. Two extras were
//     pruned on 2026-09-07 and neither left an orphan, which is the only reason they could go:
//     `independents` keeps its card on `/local/:cycle` AND a crawlable link in the `/elections`
//     prerendered body (`ELECTIONS_HUB_SECTIONS`, where it is allowlisted as a link with no
//     tile), and `/governance/mayor-pay` is canonical under Governance, where it has both a
//     hub tile and its own `mp_page_title` leaf. `hubMenuCoverage.test.ts` now holds the
//     equality in both directions.
export const electionsMenu: MenuItem[] = [
  {
    title: "nav_elections",
    link: "/elections",
    // ⚠ TWO COLUMNS LIKE THE OTHER TWO, since 2026-09-07. It was the last single-column
    // dropdown and it was also the TALLEST — measured 677px at a 900px viewport, i.e. already
    // scrolling inside its own panel, while Потребление used two columns for 13 leaves. The
    // audit that found the mismatch is in hubMenuCoverage.test.ts.
    columns: 2,
    subMenu: [
      { title: "menu_overview", link: "/elections", mobileOnly: true },
      {
        title: "elections_band_results",
        group: true,
        subMenu: [
          { title: "elections_tile_parliamentary", link: "/parliamentary" },
          // ⚠ THROUGH `presidentialUrl`, NEVER A TEMPLATE. `presidentialRoutes.ts` is the
          // family's one URL builder; a private `/presidential/${id}` here is the copy that
          // keeps working until the family moves and then nothing compares the two. The `!`
          // is safe on a CATALOGUED id — the builder returns null only for an empty or
          // separator-bearing cycle — and `menuCopy.test.ts` asserts no menu link is empty,
          // so a catalogue that ever went blank fails there rather than rendering `href=""`.
          {
            title: "elections_tile_presidential",
            link: presidentialUrl(LATEST_PRESIDENTIAL_CYCLE, "country")!,
          },
          { title: "elections_tile_local", link: `/local/${c}` },
          { title: "chmi_feed_title", link: "/local/chmi" },
        ],
      },
      { title: "-" },
      {
        title: "elections_band_places",
        group: true,
        subMenu: [
          {
            title: "local_national_municipalities",
            link: `/local/${c}/municipalities`,
          },
          { title: "local_all_regions", link: `/local/${c}/regions` },
          { title: "local_national_runoffs", link: `/local/${c}/runoffs` },
          {
            title: "local_national_split_control",
            link: `/local/${c}/split-control`,
          },
        ],
      },
      { title: "-" },
      {
        title: "elections_band_rankings",
        group: true,
        subMenu: [
          {
            title: "local_leaderboard_mayors_by_party",
            link: `/local/${c}/mayors-by-party`,
          },
          {
            title: "local_leaderboard_council_votes",
            link: `/local/${c}/council-votes`,
          },
          {
            title: "local_leaderboard_strongest_mandates",
            link: `/local/${c}/strongest-mandates`,
          },
          {
            title: "local_leaderboard_closest_races",
            link: `/local/${c}/closest-races`,
          },
        ],
      },
      { title: "-" },
      {
        title: "elections_band_analysis",
        group: true,
        subMenu: [
          { title: "analysis_hub_nav", link: "/parliamentary/analysis" },
          { title: "reports_hub_nav", link: "/parliamentary/reports" },
          { title: "local_leaderboard_swing", link: `/local/${c}/swing` },
          { title: "sverka_title", link: "/sverka" },
        ],
      },
    ],
  },
];

export const governanceMenu: MenuItem[] = [
  {
    title: "nav_governance",
    link: "/governance",
    // ⚠ THE HUB'S OWN FIVE CLUSTERS, ONE LEAF PER TILE. It was a curated 12-leaf flat list
    // („the depth lives in the hubs, not the dropdown"), which meant FOURTEEN of the hub's
    // twenty-five tiles had no menu entry at all — /council, /governments, /persons,
    // /connections, /companies, the six /indicators domains, /demographics, the tax
    // calculator and the simulator. None was unreachable, but the two surfaces answered
    // different questions about what Управление contains, and only one of them was on
    // every page. The group headings are `GOV_HUB_CLUSTERS`' own label keys, so the menu
    // and the hub cannot disagree about the sections — the same rule `electionsMenu` uses
    // for the `/elections` bands, and `hubMenuCoverage.test.ts` is what enforces it.
    //
    // ⚠ `/indicators` IS DELIBERATELY NOT A LEAF. The hub explodes it into its six domain
    // tiles, so a leaf for the landing would be the one menu entry with no tile — the exact
    // asymmetry this restructure removes. It stays reachable from the `GovernanceBreadcrumb`
    // („Показатели →") that `IndicatorsNav` renders on every one of those six sub-pages.
    //
    // ⚠ `columns: 2` IS LOAD-BEARING NOW, not cosmetic: at 25 leaves the single-column panel
    // runs past the viewport. It also FILTERS OUT every non-group child on desktop, so a leaf
    // added outside a group would silently vanish there while still rendering on mobile.
    columns: 2,
    subMenu: [
      { title: "menu_overview", link: "/governance", mobileOnly: true },
      {
        title: "gov_hub_cluster_money",
        group: true,
        subMenu: [
          { title: "budget_link_label", link: "/budget" },
          { title: "procurement_link_label", link: "/procurement" },
          { title: "funds_index_title", link: "/funds" },
          { title: "subsidies_nav", link: "/subsidies" },
          { title: "mf_browse_nav", link: "/governance/municipal-finance" },
          { title: "sectors_hub_nav", link: "/governance/sectors" },
        ],
      },
      { title: "-" },
      {
        title: "gov_hub_cluster_accountability",
        group: true,
        subMenu: [
          { title: "gov_hub_parliament_title", link: "/parliament" },
          { title: "council_hub_title", link: "/council" },
          { title: "governments_title", link: "/governments" },
          {
            title: "menu_group_declarations",
            link: "/governance/declarations",
          },
          // ⚠ THE ONLY MENU HOME THIS DESTINATION HAS. It was ALSO a leaf in the elections
          // menu (under its own `mp_local_menu_title` key, beside the mayor leaderboard)
          // until the dropdowns were reduced to their hubs' tiles; `reportMenus.test.ts`
          // now pins both halves — one governance leaf, and no `/governance/*` link left
          // in the elections tree.
          { title: "mp_page_title", link: "/governance/mayor-pay" },
          { title: "persons_title", link: "/persons" },
          { title: "connections_link_label", link: "/connections" },
          { title: "companies_browse_title", link: "/companies" },
        ],
      },
      { title: "-" },
      {
        title: "gov_hub_cluster_indicators",
        group: true,
        subMenu: [
          { title: "gov_hub_overview_title", link: "/governance/overview" },
          { title: "indicators_nav_economy", link: "/indicators/economy" },
          { title: "indicators_nav_fiscal", link: "/indicators/fiscal" },
          { title: "indicators_nav_budgets", link: "/indicators/budgets" },
        ],
      },
      { title: "-" },
      {
        title: "gov_hub_cluster_society",
        group: true,
        subMenu: [
          {
            title: "indicators_nav_governance",
            link: "/indicators/governance",
          },
          { title: "indicators_nav_society", link: "/indicators/society" },
          { title: "demographics_title", link: "/demographics" },
          { title: "sector_schools_title", link: "/education" },
        ],
      },
      { title: "-" },
      {
        title: "gov_hub_cluster_tools",
        group: true,
        subMenu: [
          { title: "indicators_nav_compare", link: "/indicators/compare" },
          {
            title: "budget_tax_calculator_link_label",
            link: "/budget/tax-calculator",
          },
          { title: "budget_policy_page_title", link: "/budget/simulator" },
        ],
      },
    ],
  },
];

// Consumption (Потребление) — the cost-of-living dashboard.
//
// ⚠ THE HUB'S OWN FOUR SECTIONS, ONE LEAF PER TILE, reading `CONSUMPTION_SECTIONS`' label
// keys — the same rule the two menus above follow. The flat curated list it replaced had
// drifted from the hub in three ways at once: its „Карта на цените" leaf opened `/prices`,
// which is the BASKET hub and a different tile's destination; the real map (`/prices/map`)
// had no entry; and neither did `/consumption/unit-prices`. So one label named the wrong
// page and two pages were reachable only from the hub itself.
//
// ⚠ THE THREE `#hash` TILES GET NO LEAF OF THEIR OWN. „Виновно ли е еврото?", „Инфлация"
// and „Достъпност" are anchors into `/consumption/overview`, which „Анализ" already opens —
// four menu entries for one page is noise, so `hubMenuCoverage.test.ts` compares PATHNAMES.
export const consumptionMenu: MenuItem[] = [
  {
    title: "nav_consumption",
    link: "/consumption",
    columns: 2,
    subMenu: [
      { title: "menu_overview", link: "/consumption", mobileOnly: true },
      {
        title: "consumption_section_explore",
        group: true,
        subMenu: [
          // ⚠ `prices_section_overview`, NOT `prices_section_map`. This is the basket hub;
          // the map is the leaf two below, and the two labels were swapped onto one link.
          { title: "prices_section_overview", link: "/prices" },
          { title: "consumption_menu_products", link: "/consumption/products" },
          {
            title: "consumption_menu_categories",
            link: "/consumption/categories",
          },
          { title: "consumption_menu_chains", link: "/consumption/chains" },
          { title: "prices_section_map", link: "/prices/map" },
          {
            title: "consumption_menu_unit_prices",
            link: "/consumption/unit-prices",
          },
        ],
      },
      { title: "-" },
      {
        title: "consumption_section_foryou",
        group: true,
        subMenu: [
          { title: "consumption_menu_basket", link: "/consumption/basket" },
          { title: "consumption_menu_deals", link: "/consumption/deals" },
        ],
      },
      { title: "-" },
      {
        title: "consumption_section_analysis",
        group: true,
        subMenu: [
          { title: "consumption_menu_overview", link: "/consumption/overview" },
        ],
      },
      { title: "-" },
      {
        title: "consumption_section_europe",
        group: true,
        subMenu: [
          { title: "consumption_menu_eu", link: "/consumption/eu" },
          { title: "consumption_menu_fuel", link: "/consumption/fuel" },
          {
            title: "consumption_menu_electricity",
            link: "/consumption/electricity",
          },
          { title: "consumption_menu_gas", link: "/consumption/gas" },
        ],
      },
    ],
  },
];
