// The reports registry — single source of truth for the standalone /reports hub
// (ReportsHubScreen) and the curated "Доклади" FeaturedStrip on the /analysis
// hub. Pure data: the scene is referenced by `id` (REPORT_SCENES[id]).
//
// The anomaly reports form a (report-type × grain) matrix — each type exists at
// municipality / settlement / section grain. A hub tile is one link, so each
// entry deep-links its type to the grain where it reads best (section for the
// section-level anomaly hunts, settlement for the place-concentration cuts,
// municipality for the broad turnout/gainers cuts); the other grains stay
// reachable from the report page itself and the header dropdown.
//
// `statId` reuses a key already present in analysis_stats.json (turnout, risk) —
// no new precompute — so a couple of tiles carry a real number; the rest are
// descriptor + scene like the indicators hub. `featured` marks the entries the
// /analysis hub spotlights in its 3-up strip.

import { TILE_ACCENTS } from "@/ux/infographic";

export interface ReportEntry {
  id: string; // scene key (REPORT_SCENES)
  titleKey: string;
  descKey: string;
  to: string;
  accent: string; // a TILE_ACCENTS token
  /** Key into analysis_stats.json; omit for tiles with no precomputed number. */
  statId?: string;
  /** Spotlighted in the /analysis hub's curated "Доклади" strip. */
  featured?: boolean;
}

export const REPORT_CLUSTERS: { labelKey: string; reports: ReportEntry[] }[] = [
  {
    labelKey: "reports_group_signals", // Рискови сигнали
    reports: [
      {
        id: "riskScore",
        titleKey: "risk_score_title",
        descKey: "reports_risk_score_desc",
        to: "/risk-score",
        accent: TILE_ACCENTS.rose,
        statId: "risk",
        featured: true,
      },
      {
        id: "problem",
        titleKey: "problem_sections",
        descKey: "reports_problem_sections_desc",
        to: "/reports/section/problem_sections",
        accent: TILE_ACCENTS.terracotta,
        featured: true,
      },
      {
        id: "concentration",
        titleKey: "concentrated_party_votes",
        descKey: "reports_concentrated_desc",
        to: "/reports/settlement/concentrated",
        accent: TILE_ACCENTS.plum,
        featured: true,
      },
      {
        id: "additional",
        titleKey: "additional_voters",
        descKey: "reports_additional_voters_desc",
        to: "/reports/settlement/additional_voters",
        accent: TILE_ACCENTS.amber,
      },
      {
        id: "noOne",
        titleKey: "support_no_one",
        descKey: "reports_supports_no_one_desc",
        to: "/reports/settlement/supports_no_one",
        accent: TILE_ACCENTS.slate,
      },
    ],
  },
  {
    labelKey: "reports_group_votes", // Гласове и активност
    reports: [
      {
        id: "turnout",
        titleKey: "voter_turnout",
        descKey: "reports_turnout_desc",
        to: "/reports/municipality/turnout",
        accent: TILE_ACCENTS.teal,
        statId: "turnout",
      },
      {
        id: "invalid",
        titleKey: "invalid_ballots",
        descKey: "reports_invalid_ballots_desc",
        to: "/reports/settlement/invalid_ballots",
        accent: TILE_ACCENTS.clay,
      },
      {
        id: "gainers",
        titleKey: "top_gainers",
        descKey: "reports_top_gainers_desc",
        to: "/reports/municipality/top_gainers",
        accent: TILE_ACCENTS.green,
      },
      {
        id: "losers",
        titleKey: "top_losers",
        descKey: "reports_top_losers_desc",
        to: "/reports/municipality/top_losers",
        accent: TILE_ACCENTS.copper,
      },
    ],
  },
  {
    labelKey: "reports_group_machines", // Преброяване и машини
    reports: [
      {
        id: "recount",
        titleKey: "voting_recount",
        descKey: "reports_recount_desc",
        to: "/reports/section/recount",
        accent: TILE_ACCENTS.steel,
      },
      {
        id: "flash",
        titleKey: "flash_memory",
        descKey: "reports_flash_memory_desc",
        to: "/reports/section/missing_flash_memory",
        accent: TILE_ACCENTS.indigo,
      },
    ],
  },
];

/** Flat list of the reports the /analysis hub spotlights (in registry order). */
export const FEATURED_REPORTS: ReportEntry[] = REPORT_CLUSTERS.flatMap((c) =>
  c.reports.filter((r) => r.featured),
);
