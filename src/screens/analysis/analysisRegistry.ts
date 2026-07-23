// The analysis registry — single source of truth for the /analysis hub
// (AnalysisHubScreen). Pure data: the scene is referenced by `id`
// (ANALYSIS_SCENES[id]), so this module carries no JSX. Same shape idea as the
// government sectorRegistry.
//
// Two clusters mirror the old "избори" dropdown sections — Анализи (the
// per-election anomaly/analysis screens) and Инструменти и проучвания (the
// interactive tools + poll/financing dossiers). The reports matrix is fronted
// separately as a curated FeaturedStrip on the hub with a "see all" link to the
// standalone /reports hub, so it is NOT listed here.
//
// `statId` names the key this tile reads from analysis_stats.json (via
// useAnalysisStats). Tiles without a statId (the simulator) carry no overlaid
// number.

import { TILE_ACCENTS } from "@/ux/infographic";

export interface Analysis {
  id: string; // scene key (ANALYSIS_SCENES)
  titleKey: string;
  descKey: string;
  to: string;
  accent: string; // a TILE_ACCENTS token
  /** Key into analysis_stats.json; omit for tiles with no precomputed number. */
  statId?: string;
}

export const ANALYSIS_CLUSTERS: { labelKey: string; analyses: Analysis[] }[] = [
  {
    labelKey: "menu_header_analysis", // "Анализи"
    analyses: [
      {
        id: "risk",
        titleKey: "risk_analysis_title",
        descKey: "risk_analysis_desc",
        to: "/risk-analysis",
        accent: TILE_ACCENTS.rose,
        statId: "risk",
      },
      {
        id: "polls",
        titleKey: "polls_title",
        descKey: "polls_desc",
        to: "/polls",
        accent: TILE_ACCENTS.azure,
        statId: "polls",
      },
      {
        id: "benford",
        titleKey: "benford_title",
        descKey: "benford_desc",
        to: "/benford",
        accent: TILE_ACCENTS.indigo,
        statId: "benford",
      },
      {
        id: "wasted",
        titleKey: "wasted_votes_title",
        descKey: "wasted_votes_desc",
        to: "/wasted-vote",
        accent: TILE_ACCENTS.clay,
        statId: "wasted",
      },
      {
        id: "persistence",
        titleKey: "persistence_title",
        descKey: "persistence_desc",
        to: "/persistence",
        accent: TILE_ACCENTS.teal,
        statId: "persistence",
      },
    ],
  },
  {
    labelKey: "menu_header_tools_polls", // "Инструменти и проучвания"
    analyses: [
      {
        id: "simulator",
        titleKey: "coalition_simulator",
        descKey: "simulator_desc",
        to: "/simulator",
        accent: TILE_ACCENTS.plum,
      },
      {
        id: "compare",
        titleKey: "compare_title",
        descKey: "compare_desc",
        to: "/compare",
        accent: TILE_ACCENTS.steel,
        statId: "turnout",
      },
      {
        id: "financing",
        titleKey: "campaign_financing",
        descKey: "financing_desc",
        to: "/financing",
        accent: TILE_ACCENTS.gold,
        statId: "financing",
      },
    ],
  },
];
