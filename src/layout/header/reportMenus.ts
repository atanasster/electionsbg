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

export type MenuItem = {
  title: string;
  link?: string;
  subMenu?: MenuItem[];
  category?: "financials" | "recount" | "preferences" | "suemg";
};

export const electionsMenu: MenuItem[] = [
  {
    title: "nav_elections",
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
      { title: "anomaly_reports_menu" },
      { title: "risk_score_title", link: "/risk-score" },
      {
        title: "municipalities",
        subMenu: [
          {
            title: "wasted_votes_title",
            link: "/reports/municipality/wasted-votes",
          },
          {
            title: "concentrated_party_votes",
            link: "/reports/municipality/concentrated",
          },
          { title: "top_gainers", link: "/reports/municipality/top_gainers" },
          { title: "top_losers", link: "/reports/municipality/top_losers" },
          { title: "voter_turnout", link: "/reports/municipality/turnout" },
          {
            title: "invalid_ballots",
            link: "/reports/municipality/invalid_ballots",
          },
          {
            title: "additional_voters",
            link: "/reports/municipality/additional_voters",
          },
          {
            title: "support_no_one",
            link: "/reports/municipality/supports_no_one",
          },
          { title: "-", category: "recount" },
          { title: "voting_recount", category: "recount" },
          {
            title: "votes_recount",
            link: "/reports/municipality/recount",
            category: "recount",
          },
          { title: "-", category: "suemg" },
          { title: "flash_memory", category: "suemg" },
          {
            title: "missing_flash_memory",
            link: "/reports/municipality/missing_flash_memory",
            category: "suemg",
          },
          {
            title: "flash_memory_removed",
            link: "/reports/municipality/flash_memory_removed",
            category: "suemg",
          },
          {
            title: "flash_memory_added",
            link: "/reports/municipality/flash_memory_added",
            category: "suemg",
          },
          {
            title: "flash_memory_moved",
            link: "/reports/municipality/flash_memory",
            category: "suemg",
          },
        ],
      },
      {
        title: "settlements",
        subMenu: [
          {
            title: "wasted_votes_title",
            link: "/reports/settlement/wasted-votes",
          },
          {
            title: "concentrated_party_votes",
            link: "/reports/settlement/concentrated",
          },
          { title: "top_gainers", link: "/reports/settlement/top_gainers" },
          { title: "top_losers", link: "/reports/settlement/top_losers" },
          { title: "voter_turnout", link: "/reports/settlement/turnout" },
          {
            title: "invalid_ballots",
            link: "/reports/settlement/invalid_ballots",
          },
          {
            title: "additional_voters",
            link: "/reports/settlement/additional_voters",
          },
          {
            title: "support_no_one",
            link: "/reports/settlement/supports_no_one",
          },
          { title: "-", category: "recount" },
          { title: "voting_recount", category: "recount" },
          {
            title: "votes_recount",
            link: "/reports/settlement/recount",
            category: "recount",
          },
          { title: "-", category: "suemg" },
          { title: "flash_memory", category: "suemg" },
          {
            title: "missing_flash_memory",
            link: "/reports/settlement/missing_flash_memory",
            category: "suemg",
          },
          {
            title: "flash_memory_removed",
            link: "/reports/settlement/flash_memory_removed",
            category: "suemg",
          },
          {
            title: "flash_memory_added",
            link: "/reports/settlement/flash_memory_added",
            category: "suemg",
          },
          {
            title: "flash_memory_moved",
            link: "/reports/settlement/flash_memory",
            category: "suemg",
          },
        ],
      },
      {
        title: "sections",
        subMenu: [
          {
            title: "wasted_votes_title",
            link: "/reports/section/wasted-votes",
          },
          {
            title: "concentrated_party_votes",
            link: "/reports/section/concentrated",
          },
          { title: "top_gainers", link: "/reports/section/top_gainers" },
          { title: "top_losers", link: "/reports/section/top_losers" },
          { title: "voter_turnout", link: "/reports/section/turnout" },
          {
            title: "invalid_ballots",
            link: "/reports/section/invalid_ballots",
          },
          {
            title: "additional_voters",
            link: "/reports/section/additional_voters",
          },
          {
            title: "support_no_one",
            link: "/reports/section/supports_no_one",
          },
          {
            title: "problem_sections",
            link: "/reports/section/problem_sections",
          },
          { title: "-", category: "recount" },
          { title: "voting_recount", category: "recount" },
          {
            title: "votes_recount",
            link: "/reports/section/recount",
            category: "recount",
          },
          {
            title: "zero_votes",
            link: "/reports/section/recount_zero_votes",
            category: "recount",
          },
          { title: "-", category: "suemg" },
          { title: "flash_memory", category: "suemg" },
          {
            title: "missing_flash_memory",
            link: "/reports/section/missing_flash_memory",
            category: "suemg",
          },
          {
            title: "flash_memory_removed",
            link: "/reports/section/flash_memory_removed",
            category: "suemg",
          },
          {
            title: "flash_memory_added",
            link: "/reports/section/flash_memory_added",
            category: "suemg",
          },
          {
            title: "flash_memory_moved",
            link: "/reports/section/flash_memory",
            category: "suemg",
          },
        ],
      },
    ],
  },
];

export const governanceMenu: MenuItem[] = [
  {
    title: "nav_governance",
    subMenu: [
      { title: "governance_title", link: "/governance" },
      { title: "-" },
      { title: "dashboard_section_parliament", link: "/parliament" },
      { title: "parliament_cohesion_title", link: "/parliament/cohesion" },
      { title: "parliament_embedding_title", link: "/parliament/embedding" },
      { title: "sessions_index_title", link: "/votes" },
      { title: "-" },
      { title: "connections_link_label", link: "/connections" },
      { title: "all_companies", link: "/mp/companies" },
      { title: "mp_assets_link_label", link: "/mp-assets" },
      { title: "mp_cars_link_label", link: "/mp-cars" },
      { title: "-" },
      { title: "budget_link_label", link: "/budget" },
      { title: "procurement_link_label", link: "/procurement" },
      { title: "-" },
      { title: "governments_title", link: "/governments" },
      { title: "indicators_page_title", link: "/indicators" },
      { title: "demographics_title", link: "/demographics" },
    ],
  },
];
