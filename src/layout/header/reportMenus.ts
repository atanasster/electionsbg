// Header dropdowns match the two-dashboard architecture (Elections home +
// Governance home):
//
//   electionsMenu   — risk analysis, comparisons, polls, simulator, the
//                     election-cycle financing dossier, plus the anomaly
//                     reports (municipalities / settlements / sections)
//                     since they're all scoped to individual elections.
//   governanceMenu  — parliament, MP declarations, budget, procurement,
//                     governments, demographics; the long-running pillars
//                     that span parliament terms.
//
// Both trees share the same MenuItem shape so Header.tsx's recursive
// RenderMenuItem walks them with identical logic — only the data differs.
// The same shape is reused on mobile (Header.tsx renders each top-level
// entry as a collapsible DropdownMenuSub), so any subgrouping added here
// shortens the mobile menu automatically.

export type MenuItem = {
  title: string;
  link?: string;
  subMenu?: MenuItem[];
  category?: "financials" | "recount" | "preferences" | "suemg";
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
      { title: "risk_analysis_title", link: "/risk-analysis" },
      { title: "compare_title", link: "/compare" },
      { title: "wasted_votes_title", link: "/wasted-vote" },
      { title: "persistence_title", link: "/persistence" },
      { title: "benford_title", link: "/benford" },
      { title: "-" },
      { title: "polls_title", link: "/polls" },
      { title: "coalition_simulator", link: "/simulator" },
      { title: "-" },
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

export const governanceMenu: MenuItem[] = [
  {
    title: "nav_governance",
    link: "/governance",
    subMenu: [
      { title: "governance_overview", link: "/governance" },
      { title: "-" },
      {
        title: "menu_group_parliament",
        subMenu: [
          { title: "dashboard_section_parliament", link: "/parliament" },
          { title: "parliament_cohesion_title", link: "/parliament/cohesion" },
          {
            title: "parliament_embedding_title",
            link: "/parliament/embedding",
          },
          { title: "sessions_index_title", link: "/votes" },
        ],
      },
      {
        title: "menu_group_declarations",
        subMenu: [
          { title: "connections_link_label", link: "/connections" },
          { title: "all_companies", link: "/mp/companies" },
          { title: "mp_assets_link_label", link: "/mp-assets" },
          { title: "mp_cars_link_label", link: "/mp-cars" },
        ],
      },
      {
        title: "menu_group_state",
        subMenu: [
          { title: "budget_link_label", link: "/budget" },
          {
            title: "budget_tax_calculator_link_label",
            link: "/budget/tax-calculator",
          },
          { title: "procurement_link_label", link: "/procurement" },
          { title: "funds_index_title", link: "/funds" },
          { title: "governments_title", link: "/governments" },
          { title: "indicators_page_title", link: "/indicators" },
          { title: "demographics_title", link: "/demographics" },
        ],
      },
    ],
  },
];
