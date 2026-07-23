// Header dropdowns match the three-dashboard architecture (Elections home,
// Local-elections home, Governance home):
//
//   electionsMenu   — risk analysis, comparisons, polls, simulator, the
//                     election-cycle financing dossier, plus the anomaly
//                     reports (municipalities / settlements / sections)
//                     since they're all scoped to individual elections.
//   localMenu       — the parallel municipal-elections tree: mayor/council
//                     leaderboards, the município lists, extraordinary
//                     elections and the officials-vs-ЦИК reconciliation.
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

export const electionsMenu: MenuItem[] = [
  {
    title: "nav_elections",
    link: "/",
    // The two hubs ARE the elections navigation now — the analyses hub fronts
    // risk / Benford / wasted votes / loyalty / comparison + the simulator,
    // polls and financing dossiers; the reports hub fronts the anomaly-report
    // matrix. The old per-analysis / per-report leaf lists lived here before and
    // now live inside the hubs (depth in the hubs, not the dropdown).
    subMenu: [
      { title: "menu_overview", link: "/", mobileOnly: true },
      { title: "analysis_hub_nav", link: "/parliamentary/analysis" },
      { title: "reports_hub_nav", link: "/parliamentary/reports" },
    ],
  },
];

// Top-nav links pin the latest regular cycle; once on a local page the date
// selector lets the visitor switch to an earlier cycle.
const c = LATEST_LOCAL_CYCLE;

export const localMenu: MenuItem[] = [
  {
    title: "nav_local",
    link: `/local/${c}`,
    subMenu: [
      { title: "menu_overview", link: `/local/${c}`, mobileOnly: true },
      {
        title: "local_menu_group_results",
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
          { title: "local_leaderboard_swing", link: `/local/${c}/swing` },
        ],
      },
      { title: "-" },
      {
        title: "local_menu_group_places",
        group: true,
        subMenu: [
          {
            title: "local_national_municipalities",
            link: `/local/${c}/municipalities`,
          },
          { title: "local_national_runoffs", link: `/local/${c}/runoffs` },
          {
            title: "local_national_split_control",
            link: `/local/${c}/split-control`,
          },
          {
            title: "local_national_independents",
            link: `/local/${c}/independents`,
          },
          { title: "local_all_regions", link: `/local/${c}/regions` },
        ],
      },
      { title: "-" },
      { title: "chmi_feed_title", link: "/local/chmi" },
      { title: "sverka_title", link: "/sverka" },
    ],
  },
];

export const governanceMenu: MenuItem[] = [
  {
    title: "nav_governance",
    link: "/governance",
    // Collapsed from the old 4-group / 18-leaf mega-menu to the curated set of
    // sub-hubs (governance-hub-v1 plan). Each links to a hub that carries its
    // own shortcut tiles — the depth lives in the hubs, not the dropdown. The
    // deep leaves (tax calculator, simulator, votes, cohesion, mp-assets,
    // officials, indicator themes, demographics…) are surfaced as shortcut
    // tiles inside /budget, /parliament, /governance/declarations, /indicators.
    subMenu: [
      { title: "menu_overview", link: "/governance", mobileOnly: true },
      { title: "budget_link_label", link: "/budget" },
      { title: "procurement_link_label", link: "/procurement" },
      { title: "funds_index_title", link: "/funds" },
      { title: "sectors_hub_nav", link: "/governance/sectors" },
      { title: "sector_schools_title", link: "/education" },
      { title: "gov_hub_parliament_title", link: "/parliament" },
      { title: "menu_group_declarations", link: "/governance/declarations" },
      { title: "gov_hub_indicators_title", link: "/indicators" },
      { title: "gov_hub_overview_title", link: "/governance/overview" },
    ],
  },
];

// Consumption (Потребление) — the cost-of-living dashboard. Phase 1 surfaces
// the КЗП basket views (overview + price map + the per-product/place explorer);
// fuel, wages and property land in later phases.
// Curated flat list of the Consumption sub-pages — same pattern as
// governanceMenu: one link per sub-page, each a hub/browser that carries its own
// depth (the /consumption tiles + the breadcrumbs do the rest). Order mirrors
// the hub sections (browse the prices · personal tools · analysis · vs Europe).
export const consumptionMenu: MenuItem[] = [
  {
    title: "nav_consumption",
    link: "/consumption",
    subMenu: [
      { title: "menu_overview", link: "/consumption", mobileOnly: true },
      { title: "consumption_menu_products", link: "/consumption/products" },
      { title: "consumption_menu_categories", link: "/consumption/categories" },
      { title: "consumption_menu_chains", link: "/consumption/chains" },
      { title: "prices_section_map", link: "/prices" },
      { title: "consumption_menu_basket", link: "/consumption/basket" },
      { title: "consumption_menu_deals", link: "/consumption/deals" },
      { title: "consumption_menu_overview", link: "/consumption/overview" },
      { title: "consumption_menu_eu", link: "/consumption/eu" },
      { title: "consumption_menu_fuel", link: "/consumption/fuel" },
      {
        title: "consumption_menu_electricity",
        link: "/consumption/electricity",
      },
      { title: "consumption_menu_gas", link: "/consumption/gas" },
    ],
  },
];
