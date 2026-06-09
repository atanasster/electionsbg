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
// Each top-level menu is a *flat* panel: leaf links grouped under
// non-clickable section headers (a MenuItem with neither `link` nor
// `subMenu` renders as a DropdownMenuLabel) and separated by "-" rules.
// Flattening keeps every leaf one open away — no nested fly-outs to hover —
// except the reports matrix, which stays nested because of its size.
//
// Both trees share the same MenuItem shape so Header.tsx's recursive
// RenderMenuItem walks them with identical logic — only the data differs.
// The same shape is reused on mobile (Header.tsx renders each top-level
// entry as a collapsible DropdownMenuSub), so any subgrouping added here
// shortens the mobile menu automatically. `mobileOnly` items (the section
// "Overview" home links) surface only in the mobile tree — on desktop the
// split-button title already links to the section dashboard, so they'd be
// redundant there.

import { LATEST_LOCAL_CYCLE } from "@/data/local/useLatestLocalCycle";

export type MenuItem = {
  title: string;
  link?: string;
  subMenu?: MenuItem[];
  category?: "financials" | "recount" | "preferences" | "suemg";
  // Rendered only inside the mobile hamburger tree. Used for the section
  // "Overview" home link, which the desktop split-button title supplies.
  mobileOnly?: boolean;
};

const buildLocationReportSubMenu = (
  scope: "municipality" | "settlement" | "section",
): MenuItem[] => {
  const items: MenuItem[] = [
    { title: "wasted_votes_title", link: `/reports/${scope}/wasted-votes` },
    {
      title: "concentrated_party_votes",
      link: `/reports/${scope}/concentrated`,
    },
    { title: "top_gainers", link: `/reports/${scope}/top_gainers` },
    { title: "top_losers", link: `/reports/${scope}/top_losers` },
    { title: "voter_turnout", link: `/reports/${scope}/turnout` },
    { title: "invalid_ballots", link: `/reports/${scope}/invalid_ballots` },
    { title: "additional_voters", link: `/reports/${scope}/additional_voters` },
    { title: "support_no_one", link: `/reports/${scope}/supports_no_one` },
  ];
  if (scope === "section") {
    items.push({
      title: "problem_sections",
      link: `/reports/section/problem_sections`,
    });
  }
  items.push(
    { title: "-", category: "recount" },
    { title: "voting_recount", category: "recount" },
    {
      title: "votes_recount",
      link: `/reports/${scope}/recount`,
      category: "recount",
    },
  );
  if (scope === "section") {
    items.push({
      title: "zero_votes",
      link: `/reports/section/recount_zero_votes`,
      category: "recount",
    });
  }
  items.push(
    { title: "-", category: "suemg" },
    { title: "flash_memory", category: "suemg" },
    {
      title: "missing_flash_memory",
      link: `/reports/${scope}/missing_flash_memory`,
      category: "suemg",
    },
    {
      title: "flash_memory_removed",
      link: `/reports/${scope}/flash_memory_removed`,
      category: "suemg",
    },
    {
      title: "flash_memory_added",
      link: `/reports/${scope}/flash_memory_added`,
      category: "suemg",
    },
    {
      title: "flash_memory_moved",
      link: `/reports/${scope}/flash_memory`,
      category: "suemg",
    },
  );
  return items;
};

export const electionsMenu: MenuItem[] = [
  {
    title: "nav_elections",
    link: "/",
    subMenu: [
      { title: "menu_overview", link: "/", mobileOnly: true },
      { title: "menu_header_analysis" },
      { title: "risk_analysis_title", link: "/risk-analysis" },
      { title: "benford_title", link: "/benford" },
      { title: "wasted_votes_title", link: "/wasted-vote" },
      { title: "persistence_title", link: "/persistence" },
      { title: "compare_title", link: "/compare" },
      { title: "-" },
      { title: "menu_header_tools_polls" },
      { title: "coalition_simulator", link: "/simulator" },
      { title: "polls_title", link: "/polls" },
      // The financing dossier and its leading rule share the "financials"
      // gate so both disappear together on cycles with no financing data.
      { title: "-", category: "financials" },
      {
        title: "campaign_financing",
        link: "/financing",
        category: "financials",
      },
      { title: "-" },
      {
        title: "anomaly_reports_menu",
        subMenu: [
          { title: "risk_score_title", link: "/risk-score" },
          {
            title: "municipalities",
            subMenu: buildLocationReportSubMenu("municipality"),
          },
          {
            title: "settlements",
            subMenu: buildLocationReportSubMenu("settlement"),
          },
          { title: "sections", subMenu: buildLocationReportSubMenu("section") },
        ],
      },
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
      { title: "local_menu_group_results" },
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
      { title: "-" },
      { title: "local_menu_group_places" },
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
    subMenu: [
      { title: "menu_overview", link: "/governance", mobileOnly: true },
      { title: "menu_header_budget_spending" },
      { title: "budget_link_label", link: "/budget" },
      {
        title: "budget_tax_calculator_link_label",
        link: "/budget/tax-calculator",
      },
      { title: "procurement_link_label", link: "/procurement" },
      { title: "funds_index_title", link: "/funds" },
      { title: "-" },
      { title: "menu_group_parliament" },
      { title: "dashboard_section_parliament", link: "/parliament" },
      { title: "sessions_index_title", link: "/votes" },
      { title: "parliament_cohesion_title", link: "/parliament/cohesion" },
      { title: "parliament_embedding_title", link: "/parliament/embedding" },
      { title: "-" },
      { title: "menu_group_declarations" },
      { title: "connections_link_label", link: "/connections" },
      { title: "mp_assets_link_label", link: "/mp-assets" },
      { title: "mp_cars_link_label", link: "/mp-cars" },
      { title: "all_companies", link: "/mp/companies" },
      { title: "-" },
      { title: "menu_header_indicators_context" },
      { title: "governments_title", link: "/governments" },
      { title: "indicators_page_title", link: "/indicators" },
      { title: "prices_page_title", link: "/prices" },
      { title: "eu_compare_menu_label", link: "/indicators/compare" },
      { title: "demographics_title", link: "/demographics" },
    ],
  },
];

// Consumption (Потребление) — the cost-of-living dashboard. Phase 1 surfaces
// the КЗП basket views (overview + price map + the per-product/place explorer);
// fuel, wages and property land in later phases.
export const consumptionMenu: MenuItem[] = [
  {
    title: "nav_consumption",
    link: "/consumption",
    subMenu: [
      { title: "menu_overview", link: "/consumption", mobileOnly: true },
      { title: "prices_section_overview", link: "/consumption" },
      { title: "prices_section_map", link: "/consumption#map" },
      { title: "prices_page_title", link: "/prices" },
    ],
  },
];
