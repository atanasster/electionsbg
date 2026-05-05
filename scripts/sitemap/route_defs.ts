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
  "simulator",
  "compare",
  "timeline",
  "financing",
  "parties",
  "regions",
  "articles",
];

export const routeDefs = (year: string): RouteDefs => [
  { path: "index", file: `public/${year}/region_votes.json` },
  { path: "sofia", file: `public/${year}/region_votes.json` },
  { path: "about", file: `src/screens/AboutScreen.tsx` },
  { path: "simulator", file: `src/screens/SimulatorScreen.tsx` },
  { path: "compare", file: `src/screens/CompareScreen.tsx` },
  { path: "timeline", file: `src/screens/PartyTimelineScreen.tsx` },
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
    file: `public/${year}/municipalities/by/:id`,
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
  { path: "financing", file: `public/${year}/parties/financing.json` },
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
    // Sub-tabs deliberately omitted: /candidate/{name}/sections and /donations
    // are not prerendered (no per-tab title/description), so emitting them in
    // the sitemap pointed crawlers at SPA-fallback URLs that all served the
    // homepage <title>. The base /candidate/{name} is what humans search for;
    // the in-app tabs render the same underlying data with a different view.
    // Re-add subTabs here only after also adding a buildCandidateSubTabRoutes
    // entry in scripts/prerender/dynamicRoutes.ts that emits unique meta.
  },
  {
    path: "reports",
    children: [
      {
        path: "municipality",
        children: [
          {
            path: "concentrated",
            file: `public/${year}/reports/municipality/concentrated.json`,
          },
          {
            path: "top_gainers",
            file: `public/${year}/reports/municipality/top_gainers.json`,
          },
          {
            path: "top_losers",
            file: `public/${year}/reports/municipality/top_losers.json`,
          },
          {
            path: "turnout",
            file: `public/${year}/reports/municipality/turnout.json`,
          },
          {
            path: "invalid_ballots",
            file: `public/${year}/reports/municipality/invalid_ballots.json`,
          },
          {
            path: "additional_voters",
            file: `public/${year}/reports/municipality/additional_voters.json`,
          },
          {
            path: "supports_no_one",
            file: `public/${year}/reports/municipality/supports_noone.json`,
          },
          {
            path: "recount",
            file: `public/${year}/reports/municipality/recount.json`,
          },
          {
            path: "recount_zero_votes",
            file: `public/${year}/reports/municipality/recount_zero_votes.json`,
          },
          {
            path: "flash_memory",
            file: `public/${year}/reports/municipality/suemg.json`,
          },
          {
            path: "flash_memory_added",
            file: `public/${year}/reports/municipality/suemg_added.json`,
          },
          {
            path: "flash_memory_removed",
            file: `public/${year}/reports/municipality/suemg_removed.json`,
          },
          {
            path: "missing_flash_memory",
            file: `public/${year}/reports/municipality/suemg_missing_flash.json`,
          },
        ],
      },
      {
        path: "settlement",
        children: [
          {
            path: "concentrated",
            file: `public/${year}/reports/settlement/concentrated.json`,
          },
          {
            path: "top_gainers",
            file: `public/${year}/reports/settlement/top_gainers.json`,
          },
          {
            path: "top_losers",
            file: `public/${year}/reports/settlement/top_losers.json`,
          },
          {
            path: "turnout",
            file: `public/${year}/reports/settlement/turnout.json`,
          },
          {
            path: "invalid_ballots",
            file: `public/${year}/reports/settlement/invalid_ballots.json`,
          },
          {
            path: "additional_voters",
            file: `public/${year}/reports/settlement/additional_voters.json`,
          },
          {
            path: "supports_no_one",
            file: `public/${year}/reports/settlement/supports_noone.json`,
          },
          {
            path: "recount",
            file: `public/${year}/reports/settlement/recount.json`,
          },
          {
            path: "recount_zero_votes",
            file: `public/${year}/reports/settlement/recount_zero_votes.json`,
          },
          {
            path: "flash_memory",
            file: `public/${year}/reports/settlement/suemg.json`,
          },
          {
            path: "flash_memory_added",
            file: `public/${year}/reports/settlement/suemg_added.json`,
          },
          {
            path: "flash_memory_removed",
            file: `public/${year}/reports/settlement/suemg_removed.json`,
          },
          {
            path: "missing_flash_memory",
            file: `public/${year}/reports/settlement/suemg_missing_flash.json`,
          },
        ],
      },
      {
        path: "section",
        children: [
          {
            path: "concentrated",
            file: `public/${year}/reports/section/concentrated.json`,
          },
          {
            path: "top_gainers",
            file: `public/${year}/reports/section/top_gainers.json`,
          },
          {
            path: "top_losers",
            file: `public/${year}/reports/section/top_losers.json`,
          },
          {
            path: "turnout",
            file: `public/${year}/reports/section/turnout.json`,
          },
          {
            path: "invalid_ballots",
            file: `public/${year}/reports/section/invalid_ballots.json`,
          },
          {
            path: "additional_voters",
            file: `public/${year}/reports/section/additional_voters.json`,
          },
          {
            path: "supports_no_one",
            file: `public/${year}/reports/section/supports_noone.json`,
          },
          {
            path: "recount",
            file: `public/${year}/reports/section/recount.json`,
          },
          {
            path: "recount_zero_votes",
            file: `public/${year}/reports/section/recount_zero_votes.json`,
          },
          {
            path: "flash_memory",
            file: `public/${year}/reports/section/suemg.json`,
          },
          {
            path: "flash_memory_added",
            file: `public/${year}/reports/section/suemg_added.json`,
          },
          {
            path: "flash_memory_removed",
            file: `public/${year}/reports/section/suemg_removed.json`,
          },
          {
            path: "missing_flash_memory",
            file: `public/${year}/reports/section/suemg_missing_flash.json`,
          },
          {
            path: "problem_sections",
            file: `public/problem_sections_stats.json`,
          },
        ],
      },
    ],
  },
];
