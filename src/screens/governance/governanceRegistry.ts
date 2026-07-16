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
    // Показатели — the indicators feature, surfaced as its six topical domains
    // directly on the hub (was a single "Показатели" tile → /indicators). Titles
    // reuse the indicators sub-nav label keys so the pills and these tiles agree.
    labelKey: "gov_hub_cluster_indicators",
    tiles: [
      {
        id: "overview",
        titleKey: "gov_hub_overview_title",
        descKey: "gov_hub_overview_desc",
        to: "/governance/overview",
        accent: TILE_ACCENTS.slate,
      },
      {
        id: "ind_economy",
        titleKey: "indicators_nav_economy",
        descKey: "gov_hub_ind_economy_desc",
        to: "/indicators/economy",
        accent: TILE_ACCENTS.green,
      },
      {
        id: "ind_fiscal",
        titleKey: "indicators_nav_fiscal",
        descKey: "gov_hub_ind_fiscal_desc",
        to: "/indicators/fiscal",
        accent: TILE_ACCENTS.amber,
      },
      {
        id: "ind_budgets",
        titleKey: "indicators_nav_budgets",
        descKey: "gov_hub_ind_budgets_desc",
        to: "/indicators/budgets",
        accent: TILE_ACCENTS.gold,
      },
      {
        id: "ind_governance",
        titleKey: "indicators_nav_governance",
        descKey: "gov_hub_ind_governance_desc",
        to: "/indicators/governance",
        accent: TILE_ACCENTS.indigo,
      },
      {
        id: "ind_society",
        titleKey: "indicators_nav_society",
        descKey: "gov_hub_ind_society_desc",
        to: "/indicators/society",
        accent: TILE_ACCENTS.terracotta,
      },
      {
        id: "ind_compare",
        titleKey: "indicators_nav_compare",
        descKey: "gov_hub_ind_compare_desc",
        to: "/indicators/compare",
        accent: TILE_ACCENTS.azure,
      },
    ],
  },
];
