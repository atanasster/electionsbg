// The anomaly-report (type × grain) matrix — the single source of truth for
// which grains each report exists at, and the module every other consumer
// enumerates from.
//
// Why this exists: the reports hub (reportsHubRegistry) deep-links each report
// type to exactly ONE grain — "the grain where it reads best" — and its comment
// claimed the rest "stay reachable from the report page itself and the header
// dropdown". Both had stopped being true: there was no grain switcher on the
// report page, and the header dropdown was collapsed to two hub links when the
// mega-menu went away. That left **28** of the 41 routed report pages with no
// inbound link at all (the hub links 10 leaves; WastedVoteScreen links the
// three `wasted-votes` grains) while they all still sat in the sitemap — the
// "crawlable but unlinked" state that earns zero impressions.
//
// ReportGrainNav rescues **18** of those 28: it only offers sibling GRAINS, so
// it reaches a type only if that type already has one linked grain. The four
// types that front no hub tile are handled by reportsHubRegistry instead, and
// `everyReportTypeHasAnEntryPoint` in reportsMatrix.test.ts is what holds that.
//
// This module is the THIRD declaration of the matrix, after `routes.tsx` (41
// <Route> leaves) and `scripts/prerender/dynamicRoutes.ts`. The prerender copy
// used to be a hand-maintained list and had silently drifted three pages short
// — `/reports/*/wasted-votes` were routed and linked but had no prerendered
// HTML and no sitemap entry. It now ENUMERATES from here, and
// reportsMatrix.test.ts gates this file against `routes.tsx`, the prerender
// copy and the sitemap, in both directions.

/** The three grains an anomaly report can be computed at, coarsest first. */
export const REPORT_GRAINS = ["municipality", "settlement", "section"] as const;
export type ReportGrain = (typeof REPORT_GRAINS)[number];

/** i18n key per grain — the same keys the report templates already pass as
 *  `levelKey`, so the switcher pill and the page caption read identically. */
export const REPORT_GRAIN_LABEL_KEY: Record<ReportGrain, string> = {
  municipality: "by_municipalities",
  settlement: "by_settlements",
  section: "by_sections",
};

/** report type → the grains it is routed at. Two types are section-only
 *  (problem_sections is a neighbourhood cluster; recount_zero_votes only means
 *  anything at the ballot-box level), the other thirteen exist at all three. */
export const REPORT_TYPE_GRAINS = {
  additional_voters: REPORT_GRAINS,
  concentrated: REPORT_GRAINS,
  flash_memory: REPORT_GRAINS,
  flash_memory_added: REPORT_GRAINS,
  flash_memory_removed: REPORT_GRAINS,
  invalid_ballots: REPORT_GRAINS,
  missing_flash_memory: REPORT_GRAINS,
  recount: REPORT_GRAINS,
  supports_no_one: REPORT_GRAINS,
  top_gainers: REPORT_GRAINS,
  top_losers: REPORT_GRAINS,
  turnout: REPORT_GRAINS,
  "wasted-votes": REPORT_GRAINS,
  problem_sections: ["section"],
  recount_zero_votes: ["section"],
} as const satisfies Record<string, readonly ReportGrain[]>;

/** Union of the routed report types — so a typo in a caller is a compile error
 *  rather than a runtime `undefined` lookup. */
export type ReportType = keyof typeof REPORT_TYPE_GRAINS;

export const isReportType = (s: string): s is ReportType =>
  Object.prototype.hasOwnProperty.call(REPORT_TYPE_GRAINS, s);

/** The URL slug is NOT the data-file basename for six of the fifteen types —
 *  the routes were renamed for readability while the pipeline kept the original
 *  names (СУЕМГ = the machine flash memory). The sitemap keys its entries on the
 *  data file, so it needs this mapping to enumerate from the matrix. */
export const REPORT_DATA_FILE: Record<ReportType, string> = {
  additional_voters: "additional_voters",
  concentrated: "concentrated",
  flash_memory: "suemg",
  flash_memory_added: "suemg_added",
  flash_memory_removed: "suemg_removed",
  invalid_ballots: "invalid_ballots",
  missing_flash_memory: "suemg_missing_flash",
  recount: "recount",
  supports_no_one: "supports_noone",
  top_gainers: "top_gainers",
  top_losers: "top_losers",
  turnout: "turnout",
  "wasted-votes": "wasted_votes",
  problem_sections: "problem_sections",
  recount_zero_votes: "recount_zero_votes",
};

/** Split a pathname into its report coordinates, or null when it isn't a report
 *  leaf. Deliberately rejects anything deeper than /reports/<grain>/<type> —
 *  the problem-section detail pages (/reports/section/problem_sections/:id …)
 *  are their own screens and must not get a grain switcher. */
export const parseReportPath = (
  pathname: string,
): { grain: ReportGrain; type: ReportType } | null => {
  const parts = pathname.replace(/^\/+|\/+$/g, "").split("/");
  if (parts.length !== 3 || parts[0] !== "reports") return null;
  const [, grain, type] = parts;
  if (!(REPORT_GRAINS as readonly string[]).includes(grain)) return null;
  if (!isReportType(type)) return null;
  const grains: readonly ReportGrain[] = REPORT_TYPE_GRAINS[type];
  if (!grains.includes(grain as ReportGrain)) return null;
  return { grain: grain as ReportGrain, type };
};

export const reportHref = (grain: ReportGrain, type: ReportType): string =>
  `/reports/${grain}/${type}`;

/** Whether ReportGrainNav will render anything for this pathname. Callers use
 *  it to drop their own grain caption, which the nav's current-grain pill
 *  already states — without it the page says "По населени места" twice.
 *
 *  ReportGrainNav consumes this too rather than re-deriving the ">1 grain"
 *  test: if the two ever disagreed the page would state its grain NOWHERE
 *  (caption suppressed, nav empty), which is worse than either alone. */
export const hasGrainNav = (pathname: string): boolean => {
  const here = parseReportPath(pathname);
  return !!here && REPORT_TYPE_GRAINS[here.type].length > 1;
};

/** Every routed report page, as `<grain>/<type>` — the enumeration the
 *  prerender builder and the sitemap both drive from. */
export const everyReportPage = (): { grain: ReportGrain; type: ReportType }[] =>
  (Object.keys(REPORT_TYPE_GRAINS) as ReportType[]).flatMap((type) =>
    REPORT_TYPE_GRAINS[type].map((grain) => ({ grain, type })),
  );
