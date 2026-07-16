// The top-level /governance hub registry — the single source of truth for the
// curated list of sub-hubs shown on the Управление front door (GovernanceScreen).
// Mirrors sectorRegistry.ts: pure data, the scene is referenced by `id`
// (GOV_HUB_SCENES[id]), so this module carries no JSX.
//
// These are SUB-HUB tiles (a short curated list of related areas), not a mirror
// of the old 18-leaf dropdown: each routes to a hub that carries its own shortcut
// tiles. Titles reuse the existing menu label keys where they exist; descriptions
// are new plain-language one-liners (answer "what will I find", ≤6 words).

import { TILE_ACCENTS } from "@/ux/infographic";

export interface GovHubTile {
  id: string; // scene key (GOV_HUB_SCENES)
  titleKey: string;
  descKey: string;
  to: string;
  accent: string; // a TILE_ACCENTS token
}

export const GOV_HUB_CLUSTERS: { labelKey: string; tiles: GovHubTile[] }[] = [
  {
    labelKey: "gov_hub_cluster_money",
    tiles: [
      {
        id: "budget",
        titleKey: "budget_link_label",
        descKey: "gov_hub_budget_desc",
        to: "/budget",
        accent: TILE_ACCENTS.amber,
      },
      {
        id: "procurement",
        titleKey: "procurement_link_label",
        descKey: "procurement_hub_analysis_desc",
        to: "/procurement",
        accent: TILE_ACCENTS.teal,
      },
      {
        id: "funds",
        titleKey: "funds_index_title",
        descKey: "gov_hub_funds_desc",
        to: "/funds",
        accent: TILE_ACCENTS.azure,
      },
      {
        id: "sectors",
        titleKey: "sectors_hub_nav",
        descKey: "gov_hub_sectors_desc",
        to: "/governance/sectors",
        accent: TILE_ACCENTS.clay,
      },
    ],
  },
  {
    labelKey: "gov_hub_cluster_accountability",
    tiles: [
      {
        id: "parliament",
        titleKey: "gov_hub_parliament_title",
        descKey: "gov_hub_parliament_desc",
        to: "/parliament",
        accent: TILE_ACCENTS.plum,
      },
      {
        id: "declarations",
        titleKey: "menu_group_declarations",
        descKey: "gov_hub_declarations_desc",
        to: "/governance/declarations",
        accent: TILE_ACCENTS.rose,
      },
    ],
  },
  {
    labelKey: "gov_hub_cluster_context",
    tiles: [
      {
        id: "indicators",
        titleKey: "gov_hub_indicators_title",
        descKey: "gov_hub_indicators_desc",
        to: "/indicators",
        accent: TILE_ACCENTS.green,
      },
      {
        id: "overview",
        titleKey: "gov_hub_overview_title",
        descKey: "gov_hub_overview_desc",
        to: "/governance/overview",
        accent: TILE_ACCENTS.slate,
      },
    ],
  },
];
