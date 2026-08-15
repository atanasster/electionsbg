export type RouteDef = {
  path: string;
  file?: string;
  // For dynamic ":id" paths, these tab paths are appended to each enumerated
  // id (one URL per id × tab). Skip for tabs that show duplicate content.
  subTabs?: string[];
  children?: RouteDefs;
};
export type RouteDefs = RouteDef[];

import { SECTOR_DASHBOARD_IDS } from "@/screens/sector/sectorDashboards";

// The generic sector-dashboard slugs (sector/health, …), derived from the one
// source of truth so a new sector can't ship without a sitemap entry.
const SECTOR_SLUGS = SECTOR_DASHBOARD_IDS.map((id) => `sector/${id}`);

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
  "about",
  "sverka",
  "local/chmi",
  "data",
  "data/sources",
  "data/updates",
  "simulator",
  "compare",
  "financing",
  "financing/annual-reports",
  "parties",
  "regions",
  "articles",
  "parliamentary/analysis",
  "parliamentary/reports",
  "party-demographics",
  "governance",
  "governance/overview",
  "governance/declarations",
  "governance/municipal-finance",
  "governance/sectors",
  "parliament/attendance",
  "demographics/regions",
  "demographics/municipalities",
  "governments",
  "indicators",
  "indicators/economy",
  "indicators/fiscal",
  "indicators/budgets",
  "indicators/governance",
  "indicators/society",
  "indicators/compare",
  "budget",
  // The pre-migration single-page view, kept for the money-flow Sankey and its
  // five drilldowns — the one thing the fourteen sub-pages do not reproduce.
  // Listed here because it is ROUTED and linked; a reachable page with no
  // sitemap entry and no prerendered head is served the homepage's title and
  // canonical, which is the duplicate-content shape, not a quiet omission.
  "budget/deep-dive",
  "budget/methodology",
  "budget/explorer",
  "budget/ministries",
  "budget/revenue",
  "budget/spending",
  "budget/deviations",
  "budget/law",
  "budget/execution",
  "budget/functional",
  "budget/personnel",
  "budget/investments",
  "budget/social-funds",
  "budget/municipal",
  "budget/municipal/investments",
  "budget/municipal/capital",
  "budget/tax-calculator",
  "budget/mod",
  "budget/simulator",
  "observations",
  "demographics",
  "prices",
  "prices/map",
  "judiciary",
  "judiciary/magistrates",
  "defense",
  "water",
  "water/operators",
  "customs/warehouses",
  "pensions",
  "culture",
  "culture/films",
  "education",
  ...SECTOR_SLUGS,
  "consumption",
  "consumption/overview",
  "consumption/eu",
  "consumption/fuel",
  "consumption/electricity",
  "consumption/gas",
  "consumption/chains",
  "consumption/categories",
  "consumption/products",
  "consumption/deals",
  "consumption/unit-prices",
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
  "officials/assets",
  "persons",
  "procurement",
  "procurement/contracts",
  "procurement/appeals",
  "procurement/ngos",
  "procurement/sectors",
  "procurement/flags",
  "procurement/contractors",
  "procurement/awarders",
  "procurement/mps",
  "procurement/by-settlement",
  "subsidies",
  "funds",
  "funds/calls",
  "funds/beneficiaries",
  "funds/programmes",
  "funds/places",
  "funds/absorption",
  "funds/focus",
  "funds/interreg",
  "funds/dual-corpus",
  "funds/political",
  "funds/integrity",
  "funds/rrf",
  "parliament",
  "parliament/cohesion",
  "parliament/embedding",
  "parliament/similarity",
  "parliament/correlation",
  "votes/between",
];

export const routeDefs = (year: string): RouteDefs => [
  { path: "index", file: `data/${year}/region_votes.json` },
  { path: "sofia", file: `data/${year}/region_votes.json` },
  // Sofia's four sub-views. These go in BOTH lists, and until 2026-08-13 only
  // ENGLISH_STATIC_PAGES carried them — so the sitemap named /en/sofia/parties
  // and not the canonical /sofia/parties. Same defect as the /funds block below,
  // recurring on a second family. The `file` matches the parent's: these render
  // the election corpus, so its mtime is the honest lastmod.
  { path: "sofia/parties", file: `data/${year}/region_votes.json` },
  { path: "sofia/preferences", file: `data/${year}/region_votes.json` },
  { path: "sofia/flash-memory", file: `data/${year}/region_votes.json` },
  { path: "sofia/recount", file: `data/${year}/region_votes.json` },
  { path: "about", file: `src/screens/AboutScreen.tsx` },
  { path: "data", file: `src/screens/DataMapScreen.tsx` },
  { path: "data/sources", file: `src/screens/DataSourcesScreen.tsx` },
  { path: "data/updates", file: `src/screens/DataUpdatesScreen.tsx` },
  { path: "prices", file: `src/screens/PricesScreen.tsx` },
  { path: "prices/map", file: `src/screens/PricesMapScreen.tsx` },
  {
    path: "judiciary",
    file: `src/screens/judiciary/JudiciaryScreen.tsx`,
  },
  {
    path: "judiciary/magistrates",
    file: `src/screens/judiciary/MagistrateHoldingsBrowseScreen.tsx`,
  },
  { path: "defense", file: `src/screens/defense/DefenseScreen.tsx` },
  { path: "water", file: `src/screens/water/WaterScreen.tsx` },
  {
    path: "water/operators",
    file: `src/screens/water/WaterOperatorsScreen.tsx`,
  },
  {
    path: "customs/warehouses",
    file: `src/screens/customs/ExciseRegisterScreen.tsx`,
  },
  { path: "pensions", file: `src/screens/pensions/PensionsScreen.tsx` },
  { path: "culture", file: `src/screens/culture/CultureScreen.tsx` },
  {
    path: "culture/films",
    file: `src/screens/culture/CultureFilmsBrowserScreen.tsx`,
  },
  { path: "education", file: `src/screens/education/EducationScreen.tsx` },
  // Generic sector dashboards (/sector/:id) — one entry per graduated sector,
  // derived from the same source of truth as ENGLISH_STATIC_PAGES above. The
  // `file` is the shared screen; dist/sector/<id>/index.html is emitted by the
  // prerender (SECTOR_PAGES in scripts/prerender/routes.ts).
  ...SECTOR_SLUGS.map((path) => ({
    path,
    file: `src/screens/sector/SectorDashboardScreen.tsx`,
  })),
  // Per-school pages (/school/:id) are enumerated from data/schools/index.json
  // directly in scripts/sitemap/index.ts (like the INSTITUTION_PACKS awarders),
  // not here — route_defs carries no school entries.
  // Consumption (Потребление) view — country node. Region / município /
  // settlement consumption nodes are intentionally omitted from the sitemap for
  // now (most settlements have no price data; the place pages still resolve in
  // the SPA), matching the bounded-URL discipline used elsewhere.
  // The /funds sub-pages the hub rework split out. These go in BOTH lists: only
  // ENGLISH_STATIC_PAGES was updated first, so /en/funds/dual-corpus got a <loc> while the
  // canonical /funds/dual-corpus did not.
  {
    path: "funds/beneficiaries",
    file: `src/screens/funds/FundsBeneficiariesScreen.tsx`,
  },
  {
    path: "funds/programmes",
    file: `src/screens/funds/FundsProgrammesScreen.tsx`,
  },
  { path: "funds/places", file: `src/screens/funds/FundsPlacesScreen.tsx` },
  {
    path: "funds/absorption",
    file: `src/screens/funds/FundsAbsorptionScreen.tsx`,
  },
  { path: "funds/focus", file: `src/screens/funds/FundsFocusIndexScreen.tsx` },
  {
    path: "funds/interreg",
    file: `src/screens/funds/FundsInterregIndexScreen.tsx`,
  },
  {
    path: "funds/dual-corpus",
    file: `src/screens/funds/FundsDualCorpusScreen.tsx`,
  },
  { path: "consumption", file: `src/screens/ConsumptionScreen.tsx` },
  {
    path: "consumption/overview",
    file: `src/screens/ConsumptionOverviewScreen.tsx`,
  },
  {
    path: "consumption/eu",
    file: `src/screens/consumption/ConsumptionEuScreen.tsx`,
  },
  {
    path: "consumption/fuel",
    file: `src/screens/consumption/ConsumptionFuelScreen.tsx`,
  },
  // electricity + gas were in ENGLISH_STATIC_PAGES only — the /en mirror had a
  // <loc>, the Bulgarian original did not.
  {
    path: "consumption/electricity",
    file: `src/screens/consumption/ConsumptionElectricityScreen.tsx`,
  },
  {
    path: "consumption/gas",
    file: `src/screens/consumption/ConsumptionGasScreen.tsx`,
  },
  {
    path: "consumption/chains",
    file: `src/screens/consumption/ConsumptionChainsScreen.tsx`,
  },
  {
    path: "consumption/categories",
    file: `src/screens/consumption/ConsumptionCategoriesScreen.tsx`,
  },
  {
    path: "consumption/products",
    file: `src/screens/consumption/ProductsBrowserScreen.tsx`,
  },
  {
    path: "consumption/deals",
    file: `src/screens/consumption/ConsumptionDealsScreen.tsx`,
  },
  {
    path: "consumption/unit-prices",
    file: `src/screens/consumption/ConsumptionUnitPricesScreen.tsx`,
  },
  // consumption/basket is intentionally NOT prerendered/sitemapped — it is a
  // personal, localStorage-backed page that renders empty by default, so it has
  // no stable indexable content (unlike the data pages above).
  { path: "simulator", file: `src/screens/SimulatorScreen.tsx` },
  { path: "compare", file: `src/screens/CompareScreen.tsx` },
  { path: "governance", file: `src/screens/GovernanceScreen.tsx` },
  {
    path: "governance/overview",
    file: `src/screens/governance/GovernanceOverviewScreen.tsx`,
  },
  {
    path: "governance/declarations",
    file: `src/screens/governance/GovernanceDeclarationsScreen.tsx`,
  },
  {
    path: "governance/municipal-finance",
    file: `src/screens/governance/GovernanceMunicipalFinanceScreen.tsx`,
  },
  // The sectors hub. It is prerendered in both languages and had no <loc> in
  // either — a hub fronting 20+ sector dashboards, discoverable only by crawl.
  {
    path: "governance/sectors",
    file: `src/screens/governance/GovernanceSectorsScreen.tsx`,
  },
  {
    path: "parliament/attendance",
    file: `src/screens/ParliamentAttendanceScreen.tsx`,
  },
  { path: "governments", file: `src/screens/GovernmentsScreen.tsx` },
  // Per-cabinet detail pages — one URL per entry in data/governments.json.
  // The sitemap entry is needed even though the pages are prerendered
  // (scripts/prerender/routes.ts already enumerates them); without it
  // Google has to discover the per-cabinet URLs via crawl of internal
  // links rather than from the sitemap directly.
  { path: "governments/:id", file: `cabinets-list` },
  {
    path: "indicators",
    file: `src/screens/indicators/IndicatorsLandingScreen.tsx`,
  },
  {
    path: "indicators/economy",
    file: `src/screens/indicators/IndicatorsEconomyScreen.tsx`,
  },
  {
    path: "indicators/fiscal",
    file: `src/screens/indicators/IndicatorsFiscalScreen.tsx`,
  },
  {
    path: "indicators/budgets",
    file: `src/screens/indicators/IndicatorsCabinetBudgetsScreen.tsx`,
  },
  {
    path: "indicators/governance",
    file: `src/screens/indicators/IndicatorsGovernanceScreen.tsx`,
  },
  {
    path: "indicators/society",
    file: `src/screens/indicators/IndicatorsSocietyScreen.tsx`,
  },
  {
    path: "indicators/compare",
    file: `src/screens/indicators/IndicatorsCompareScreen.tsx`,
  },
  { path: "budget", file: `data/budget/index.json` },
  {
    // The pre-migration single-page view, kept for the money-flow Sankey and its
    // five drilldowns. ⚠️ THIS LIST AND `ENGLISH_STATIC_PAGES` ARE BOTH
    // REQUIRED — the file's own Sofia note records the last time only one of
    // them was filled, and the sitemap then named /en/… without the canonical.
    // ⚠️ THE `file` IS NOT REALLY A LASTMOD — `safeFileMod` floors every entry
    // to today, so no `file` choice here changes the emitted date. What it
    // actually controls is whether the <loc> is emitted at ALL: an unreadable
    // path drops the page silently. The screen is the honest choice anyway,
    // since unlike its siblings this page renders no single artifact but
    // thirteen tiles.
    path: "budget/deep-dive",
    file: `src/screens/BudgetScreen.tsx`,
  },
  {
    path: "budget/explorer",
    file: `data/budget/index.json`,
  },
  {
    path: "budget/ministries",
    file: `data/budget/index.json`,
  },
  {
    path: "budget/revenue",
    file: `data/budget/index.json`,
  },
  {
    path: "budget/spending",
    file: `data/budget/index.json`,
  },
  {
    path: "budget/deviations",
    file: `data/budget/index.json`,
  },
  {
    path: "budget/law",
    file: `data/budget/documents.json`,
  },
  {
    path: "budget/execution",
    file: `data/budget/index.json`,
  },
  {
    path: "budget/functional",
    file: `data/budget/index.json`,
  },
  {
    path: "budget/personnel",
    file: `data/budget/index.json`,
  },
  {
    path: "budget/investments",
    file: `data/budget/investment_program/index.json`,
  },
  {
    path: "budget/social-funds",
    file: `data/budget/noi/funds.json`,
  },
  {
    path: "budget/municipal",
    file: `data/budget/index.json`,
  },
  {
    path: "budget/municipal/investments",
    file: `data/budget/ipop/2025.json`,
  },
  {
    path: "budget/municipal/capital",
    file: `data/budget/index.json`,
  },
  {
    path: "budget/methodology",
    file: `src/screens/BudgetMethodologyScreen.tsx`,
  },
  {
    path: "budget/tax-calculator",
    file: `src/screens/BudgetTaxCalculatorScreen.tsx`,
  },
  {
    path: "budget/mod",
    file: `src/screens/BudgetModScreen.tsx`,
  },
  {
    path: "budget/simulator",
    file: `src/screens/BudgetPolicySimulatorScreen.tsx`,
  },
  { path: "budget/ministry/:id", file: `budget-ministries-list` },
  { path: "observations", file: `src/screens/ObservationsScreen.tsx` },
  { path: "demographics", file: `src/screens/DemographicsScreen.tsx` },
  {
    path: "demographics/regions",
    file: `src/screens/RegionsDemographicsScreen.tsx`,
  },
  {
    path: "demographics/municipalities",
    file: `src/screens/MunicipalitiesDemographicsScreen.tsx`,
  },

  // Risk / forensics screens.
  {
    path: "parliamentary/analysis",
    file: `src/screens/analysis/AnalysisHubScreen.tsx`,
  },
  {
    path: "parliamentary/reports",
    file: `src/screens/reports/hub/ReportsHubScreen.tsx`,
  },
  {
    path: "party-demographics",
    file: `src/screens/PartyDemographicsScreen.tsx`,
  },
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

  // Non-MP officials (cabinet, state-agency heads, regional governors).
  // Sourced from the same register.cacbg.bg pipeline as MPs.
  {
    path: "officials/assets",
    file: `data/officials/assets-rankings.json`,
  },
  // The per-official page is retired (T1.3): /officials/:id 301s to /person/:slug. The
  // prerendered person pages (the net-neutral ex-officials set) are enumerated as
  // /person/:slug instead, so no <loc> points at a URL that redirects.
  // The persons browser — the person layer's cross-cutting entry point, filed here with
  // /person/:id rather than among the procurement browsers. `file` is the freshness
  // anchor, so it points at the screen (the matview behind it has no file).
  {
    path: "persons",
    file: `src/screens/persons/PersonsBrowserScreen.tsx`,
  },
  {
    // `:id`, not `:slug` — the sitemap generator splits every dynamic path on the literal
    // ":id" token (index.ts:660); a different param name silently never expands.
    path: "person/:id",
    file: `person-list`,
  },

  // Public procurement. Every sub-page in the ProcurementNav pills, plus the
  // tile-linked drill-downs (contractors/awarders/mps/sectors), is a
  // prerendered static page (scripts/prerender/routes.ts), so each gets a
  // sitemap entry. The personal /procurement/watchlist and the still-unreleased
  // /procurement/roads (bucket-synced data only, dev-gated) are intentionally
  // omitted.
  { path: "procurement", file: `src/screens/ProcurementScreen.tsx` },
  {
    path: "procurement/contracts",
    file: `src/screens/dev/ContractsBrowserDbScreen.tsx`,
  },
  {
    path: "procurement/appeals",
    file: `src/screens/dev/AppealsBrowserDbScreen.tsx`,
  },
  {
    path: "procurement/ngos",
    file: `src/screens/dev/NgoBrowseDbScreen.tsx`,
  },
  {
    path: "procurement/sectors",
    file: `src/screens/ProcurementSectorsScreen.tsx`,
  },
  {
    path: "procurement/flags",
    file: `src/screens/ProcurementFlagsScreen.tsx`,
  },
  {
    path: "procurement/contractors",
    file: `src/screens/TopContractorsScreen.tsx`,
  },
  {
    path: "procurement/awarders",
    file: `src/screens/TopAwardersScreen.tsx`,
  },
  // The packed institution awarder pages (/awarder/:eik — roads / НОИ / НЗОК /
  // ДФЗ) are enumerated from the shared INSTITUTION_PACKS catalogue directly in
  // scripts/sitemap/index.ts, not here.
  { path: "procurement/mps", file: `src/screens/TopMpsScreen.tsx` },
  {
    path: "procurement/by-settlement",
    file: `src/screens/procurement/ProcurementBySettlementScreen.tsx`,
  },
  {
    path: "procurement/settlement/:id",
    file: `procurement-settlements-list`,
  },

  // Farm subsidies — ДФЗ corpus. The data lives only in Postgres (no JSON
  // artifact to stamp lastmod from), so the screen file stands in. The
  // /subsidies/browse table and the per-recipient /farm/:eik pages are left out
  // of the sitemap — same bounded-URL discipline as the procurement browsers.
  { path: "subsidies", file: `src/screens/SubsidiesDashboardScreen.tsx` },

  // EU funds — ИСУН 2020 corpus.
  { path: "funds", file: `data/funds/index.json` },
  // The page is a live register served from Postgres, so its lastmod is stamped from the
  // SNAPSHOT the loader reads rather than from a derived artifact — that file moves on every
  // crawl, which is exactly the cadence a crawler should see. (`sp2023.json` moves far more
  // rarely, so the ИСУН one is the honest signal.) No per-call `<loc>`: an individual procedure
  // has no page here, every row links out to the source register.
  { path: "funds/calls", file: `data/opencalls/isun.json` },
  { path: "funds/political", file: `data/funds/derived/political_links.json` },
  { path: "funds/integrity", file: `data/funds/derived/integrity.json` },
  { path: "funds/rrf", file: `data/funds/rrf_context.json` },
  { path: "funds/focus/:id", file: `funds-themes-list` },
  { path: "procurement/project/:id", file: `curated-projects-list` },
  { path: "funds/programme/:id", file: `funds-programmes-list` },
  { path: "funds/procedure/:id", file: `funds-procedures-list` },
  { path: "product/:id", file: `prices-products-list` },

  {
    path: "parliament",
    file: `src/screens/ParliamentHubScreen.tsx`,
  },
  {
    path: "parliament/cohesion",
    file: `src/screens/ParliamentCohesionScreen.tsx`,
  },
  {
    path: "parliament/embedding",
    file: `src/screens/ParliamentEmbeddingScreen.tsx`,
  },
  // The other three alignment views the parliament hub fronts. Prerendered in
  // both languages, in neither list, so no <loc> at all. `votes/between` is the
  // PICKER (`votes/between/:pair` is its detail and stays out — the pair pages
  // are enumerated nowhere and there are O(n²) of them).
  {
    path: "parliament/similarity",
    file: `src/screens/MpSimilarityScreen.tsx`,
  },
  {
    path: "parliament/correlation",
    file: `src/screens/ParliamentCorrelationScreen.tsx`,
  },
  { path: "votes/between", file: `src/screens/PartyPairBreaksScreen.tsx` },

  // Party annual financial-report filing-status catalogue (Court of Audit).
  {
    path: "financing/annual-reports",
    file: `src/screens/PartyAnnualReportsScreen.tsx`,
  },

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

  // Local elections (общински избори) dashboard tree. Cycles come from
  // src/data/json/local_elections.json (regular `_mi` cycles only); regions +
  // municipalities are enumerated from each cycle's data files. Settlement
  // pages (/local/:cycle/settlement/:ekatte) are intentionally omitted —
  // canonicalised to the município page to keep the URL count bounded.
  { path: "sverka", file: `src/screens/SverkaScreen.tsx` },
  { path: "local/chmi", file: `src/screens/ChmiFeedScreen.tsx` },
  { path: "local/:id", file: `local-cycles` },
  { path: "local/:id/region/:id", file: `local-regions` },
  { path: "local/:id/:id", file: `local-municipalities` },

  {
    path: "municipality/:id",
    file: `data/${year}/municipalities/by/:id`,
    subTabs: [
      "parties",
      "preferences",
      "flash-memory",
      "municipalities",
      "recount",
    ],
  },
  {
    path: "settlement/:id",
    file: `settlements`,
  },
  // Governance view — place ladder. The country node (/governance) is a static
  // entry above; these enumerate the region → município → settlement nodes.
  // BG only (no /en), matching /settlement and /municipality.
  // Region tier — one URL per oblast.
  { path: "governance/region/:id", file: `governance-regions` },
  // Município-grain place nodes — one URL per obshtina (from municipalities.json).
  { path: "governance/:id", file: `governance-municipalities` },
  // Settlement-grain place nodes — one URL per EKATTE (same source as
  // /settlement/:id). Surfaces the place-governance framing at /governance/:id.
  {
    path: "governance/:id",
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
            // Route slug is hyphenated; the pipeline's data file is not.
            path: "wasted-votes",
            file: `data/${year}/reports/municipality/wasted_votes.json`,
          },
          // recount_zero_votes is section-only in the prerender
          // (MUNICIPALITY_REPORTS omits it) — keeping it here would emit a
          // sitemap URL with no prerendered page.
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
            // Route slug is hyphenated; the pipeline's data file is not.
            path: "wasted-votes",
            file: `data/${year}/reports/settlement/wasted_votes.json`,
          },
          // recount_zero_votes is section-only in the prerender
          // (SETTLEMENT_REPORTS omits it) — keeping it here would emit a
          // sitemap URL with no prerendered page.
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
            // Route slug is hyphenated; the pipeline's data file is not.
            path: "wasted-votes",
            file: `data/${year}/reports/section/wasted_votes.json`,
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
