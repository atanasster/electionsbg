export type RouteDef = {
  path: string;
  file?: string;
  // For dynamic ":id" paths, these tab paths are appended to each enumerated
  // id (one URL per id × tab). Skip for tabs that show duplicate content.
  subTabs?: string[];
  children?: RouteDefs;
};
export type RouteDefs = RouteDef[];

// Static page slugs for which we emit prerendered English mirrors at /en/{slug}.
// Keep in sync with the `english:` blocks in scripts/prerender/routes.ts —
// adding a slug here without an English variant in the prerender step would
// produce a sitemap entry that resolves only via the SPA's runtime i18n.
export const ENGLISH_STATIC_PAGES = [
  "", // home → /en/
  "sofia",
  "sofia/parties",
  "sofia/preferences",
  "sofia/flash-memory",
  "sofia/recount",
  "sofia/timeline",
  "about",
  "data-changes",
  "simulator",
  "compare",
  "timeline",
  "financing",
  "parties",
  "regions",
  "articles",
  "governments",
  "observations",
  "demographics",
  "risk-analysis",
  "risk-analysis/methodology",
  "risk-score",
  "risk-score/methodology",
  "benford",
  "benford/methodology",
  "persistence",
  "wasted-vote",
  "wasted-vote/regions",
  "where-did-votes-go/methodology",
  "connections",
  "mp/companies",
  "mp-assets",
  "mp-cars",
];

export const routeDefs = (year: string): RouteDefs => [
  { path: "index", file: `data/${year}/region_votes.json` },
  { path: "sofia", file: `data/${year}/region_votes.json` },
  { path: "about", file: `src/screens/AboutScreen.tsx` },
  { path: "data-changes", file: `src/screens/DataChangesScreen.tsx` },
  { path: "simulator", file: `src/screens/SimulatorScreen.tsx` },
  { path: "compare", file: `src/screens/CompareScreen.tsx` },
  { path: "timeline", file: `src/screens/PartyTimelineScreen.tsx` },
  { path: "governments", file: `src/screens/GovernmentsScreen.tsx` },
  { path: "observations", file: `src/screens/ObservationsScreen.tsx` },
  { path: "demographics", file: `src/screens/DemographicsScreen.tsx` },

  // Risk / forensics screens.
  { path: "risk-analysis", file: `src/screens/RiskAnalysisScreen.tsx` },
  {
    path: "risk-analysis/methodology",
    file: `src/screens/RiskAnalysisMethodologyScreen.tsx`,
  },
  { path: "risk-score", file: `src/screens/RiskScoreScreen.tsx` },
  {
    path: "risk-score/methodology",
    file: `src/screens/RiskScoreMethodologyScreen.tsx`,
  },
  { path: "benford", file: `src/screens/BenfordScreen.tsx` },
  {
    path: "benford/methodology",
    file: `src/screens/BenfordMethodologyScreen.tsx`,
  },
  { path: "persistence", file: `src/screens/PersistenceScreen.tsx` },
  { path: "wasted-vote", file: `src/screens/WastedVoteScreen.tsx` },
  {
    path: "wasted-vote/regions",
    file: `src/screens/WastedVoteRegionsScreen.tsx`,
  },
  {
    path: "where-did-votes-go/methodology",
    file: `src/screens/VoteFlowMethodologyScreen.tsx`,
  },

  // MP-declaration dashboards.
  { path: "connections", file: `src/screens/ConnectionsScreen.tsx` },
  { path: "mp/companies", file: `src/screens/AllMpCompaniesScreen.tsx` },
  { path: "mp-assets", file: `src/screens/AllMpAssetsScreen.tsx` },
  { path: "mp-cars", file: `src/screens/MpCarsScreen.tsx` },

  // English mirrors of the top static pages (one URL each).
  { path: "en-mirrors", file: `english-static-pages` },

  // National-level tab pages.
  { path: "parties", file: `src/screens/AllPartiesScreen.tsx` },
  { path: "preferences", file: `src/screens/AllPreferencesScreen.tsx` },
  { path: "flash-memory", file: `src/screens/AllFlashMemoryScreen.tsx` },
  { path: "recount", file: `src/screens/AllRecountScreen.tsx` },
  { path: "regions", file: `src/screens/AllRegionsScreen.tsx` },

  // Polls.
  { path: "polls", file: `polls-index` },

  // Articles — long-form data analysis. Index page + one URL per article slug
  // listed in public/articles/index.json.
  { path: "articles", file: `articles-index` },
  { path: "articles/:id", file: `articles-list` },

  // Per-election landing pages — one URL per cycle in elections.json.
  { path: "elections/:id", file: `elections-list` },

  {
    path: "municipality/:id",
    file: `data/${year}/municipalities/by/:id`,
    subTabs: [
      "parties",
      "preferences",
      "flash-memory",
      "municipalities",
      "recount",
      "timeline",
    ],
  },
  {
    path: "settlement/:id",
    file: `settlements`,
  },
  { path: "sections/:id", file: `sections-by-ekatte` },
  { path: "section/:id", file: `sections-index` },
  { path: "financing", file: `data/${year}/parties/financing.json` },
  {
    path: "party/:id",
    file: `parties`,
    subTabs: [
      "regions",
      "municipalities",
      "settlements",
      "preferences",
      "donors",
      "donors/list",
      "income",
      "expenses",
    ],
  },
  {
    path: "candidate/:id",
    file: `candidates`,
    // Sub-tabs deliberately omitted: buildCandidateSubTabRoutes in
    // scripts/prerender/dynamicRoutes.ts now emits a thin file per sub-tab with
    // <link rel="canonical"> pointing back to /candidate/{name}, so they should
    // stay out of the sitemap (canonicalized pages don't belong there).
  },
  {
    path: "reports",
    children: [
      {
        path: "municipality",
        children: [
          {
            path: "concentrated",
            file: `data/${year}/reports/municipality/concentrated.json`,
          },
          {
            path: "top_gainers",
            file: `data/${year}/reports/municipality/top_gainers.json`,
          },
          {
            path: "top_losers",
            file: `data/${year}/reports/municipality/top_losers.json`,
          },
          {
            path: "turnout",
            file: `data/${year}/reports/municipality/turnout.json`,
          },
          {
            path: "invalid_ballots",
            file: `data/${year}/reports/municipality/invalid_ballots.json`,
          },
          {
            path: "additional_voters",
            file: `data/${year}/reports/municipality/additional_voters.json`,
          },
          {
            path: "supports_no_one",
            file: `data/${year}/reports/municipality/supports_noone.json`,
          },
          {
            path: "recount",
            file: `data/${year}/reports/municipality/recount.json`,
          },
          {
            path: "recount_zero_votes",
            file: `data/${year}/reports/municipality/recount_zero_votes.json`,
          },
          {
            path: "flash_memory",
            file: `data/${year}/reports/municipality/suemg.json`,
          },
          {
            path: "flash_memory_added",
            file: `data/${year}/reports/municipality/suemg_added.json`,
          },
          {
            path: "flash_memory_removed",
            file: `data/${year}/reports/municipality/suemg_removed.json`,
          },
          {
            path: "missing_flash_memory",
            file: `data/${year}/reports/municipality/suemg_missing_flash.json`,
          },
        ],
      },
      {
        path: "settlement",
        children: [
          {
            path: "concentrated",
            file: `data/${year}/reports/settlement/concentrated.json`,
          },
          {
            path: "top_gainers",
            file: `data/${year}/reports/settlement/top_gainers.json`,
          },
          {
            path: "top_losers",
            file: `data/${year}/reports/settlement/top_losers.json`,
          },
          {
            path: "turnout",
            file: `data/${year}/reports/settlement/turnout.json`,
          },
          {
            path: "invalid_ballots",
            file: `data/${year}/reports/settlement/invalid_ballots.json`,
          },
          {
            path: "additional_voters",
            file: `data/${year}/reports/settlement/additional_voters.json`,
          },
          {
            path: "supports_no_one",
            file: `data/${year}/reports/settlement/supports_noone.json`,
          },
          {
            path: "recount",
            file: `data/${year}/reports/settlement/recount.json`,
          },
          {
            path: "recount_zero_votes",
            file: `data/${year}/reports/settlement/recount_zero_votes.json`,
          },
          {
            path: "flash_memory",
            file: `data/${year}/reports/settlement/suemg.json`,
          },
          {
            path: "flash_memory_added",
            file: `data/${year}/reports/settlement/suemg_added.json`,
          },
          {
            path: "flash_memory_removed",
            file: `data/${year}/reports/settlement/suemg_removed.json`,
          },
          {
            path: "missing_flash_memory",
            file: `data/${year}/reports/settlement/suemg_missing_flash.json`,
          },
        ],
      },
      {
        path: "section",
        children: [
          {
            path: "concentrated",
            file: `data/${year}/reports/section/concentrated.json`,
          },
          {
            path: "top_gainers",
            file: `data/${year}/reports/section/top_gainers.json`,
          },
          {
            path: "top_losers",
            file: `data/${year}/reports/section/top_losers.json`,
          },
          {
            path: "turnout",
            file: `data/${year}/reports/section/turnout.json`,
          },
          {
            path: "invalid_ballots",
            file: `data/${year}/reports/section/invalid_ballots.json`,
          },
          {
            path: "additional_voters",
            file: `data/${year}/reports/section/additional_voters.json`,
          },
          {
            path: "supports_no_one",
            file: `data/${year}/reports/section/supports_noone.json`,
          },
          {
            path: "recount",
            file: `data/${year}/reports/section/recount.json`,
          },
          {
            path: "recount_zero_votes",
            file: `data/${year}/reports/section/recount_zero_votes.json`,
          },
          {
            path: "flash_memory",
            file: `data/${year}/reports/section/suemg.json`,
          },
          {
            path: "flash_memory_added",
            file: `data/${year}/reports/section/suemg_added.json`,
          },
          {
            path: "flash_memory_removed",
            file: `data/${year}/reports/section/suemg_removed.json`,
          },
          {
            path: "missing_flash_memory",
            file: `data/${year}/reports/section/suemg_missing_flash.json`,
          },
          {
            path: "problem_sections",
            file: `data/problem_sections_stats.json`,
          },
        ],
      },
    ],
  },
];
