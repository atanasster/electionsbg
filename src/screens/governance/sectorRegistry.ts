// The government-sector registry — the single source of truth for the sector
// list, shared by the /governance/sectors hub (GovernanceSectorsScreen) and any
// other surface that fronts sectors (e.g. the "featured sectors" block on the
// /procurement hub). Pure data: the scene is referenced by `id`
// (SECTOR_SCENES[id]), so this module carries no JSX.
//
// Each sector that lacks a bespoke dashboard (water/defense/culture/judiciary/
// pensions/education have their own) is routed to the generic sector dashboard
// at /sector/<id> (SectorDashboardScreen, config in
// src/screens/sector/sectorDashboards.ts). Those pages give a sector a proper
// KPI overview + a list of member awarders (each → /awarder/:eik), instead of
// deep-linking straight to a single institution's awarder page.

import { TILE_ACCENTS } from "@/ux/infographic";

export interface Sector {
  id: string; // scene key (SECTOR_SCENES)
  titleKey: string;
  descKey: string;
  agency: string; // Cyrillic acronym — same in both languages
  to: string;
  accent: string; // a TILE_ACCENTS token
}

export const SECTOR_CLUSTERS: { labelKey: string; sectors: Sector[] }[] = [
  {
    labelKey: "sectors_cluster_infra",
    sectors: [
      {
        id: "roads",
        titleKey: "sector_roads_title",
        descKey: "sector_roads_desc",
        agency: "АПИ",
        to: "/sector/roads",
        accent: TILE_ACCENTS.clay,
      },
      {
        id: "water",
        titleKey: "sector_water_title",
        descKey: "sector_water_desc",
        agency: "ВиК",
        to: "/water",
        accent: TILE_ACCENTS.teal,
      },
      {
        id: "transport",
        titleKey: "sector_transport_title",
        descKey: "sector_transport_desc",
        agency: "МТС",
        to: "/sector/transport",
        accent: TILE_ACCENTS.steel,
      },
      {
        id: "energy",
        titleKey: "sector_energy_title",
        descKey: "sector_energy_desc",
        agency: "БЕХ",
        to: "/sector/energy",
        accent: TILE_ACCENTS.copper,
      },
      {
        id: "environment",
        titleKey: "sector_environment_title",
        descKey: "sector_environment_desc",
        agency: "МОСВ",
        to: "/sector/environment",
        accent: TILE_ACCENTS.leaf,
      },
    ],
  },
  {
    labelKey: "sectors_cluster_social",
    sectors: [
      {
        id: "pension",
        titleKey: "sector_pension_title",
        descKey: "sector_pension_desc",
        agency: "НОИ",
        to: "/pensions",
        accent: TILE_ACCENTS.amber,
      },
      {
        id: "social",
        titleKey: "sector_social_title",
        descKey: "sector_social_desc",
        agency: "МТСП",
        to: "/sector/social",
        accent: TILE_ACCENTS.olive,
      },
      {
        id: "health",
        titleKey: "sector_health_title",
        descKey: "sector_health_desc",
        agency: "НЗОК",
        to: "/sector/health",
        accent: TILE_ACCENTS.rose,
      },
      {
        id: "edu",
        titleKey: "sector_edu_title",
        descKey: "sector_edu_desc",
        agency: "МОН",
        to: "/sector/edu",
        accent: TILE_ACCENTS.green,
      },
      {
        id: "schools",
        titleKey: "sector_schools_title",
        descKey: "sector_schools_desc",
        agency: "МОН",
        to: "/education",
        accent: TILE_ACCENTS.emerald,
      },
    ],
  },
  {
    labelKey: "sectors_cluster_state",
    sectors: [
      {
        id: "revenue",
        titleKey: "sector_revenue_title",
        descKey: "sector_revenue_desc",
        agency: "НАП",
        to: "/sector/revenue",
        accent: TILE_ACCENTS.brass,
      },
      {
        id: "customs",
        titleKey: "sector_customs_title",
        descKey: "sector_customs_desc",
        agency: "АМ",
        to: "/sector/customs",
        accent: TILE_ACCENTS.azure,
      },
      {
        id: "administration",
        titleKey: "sector_admin_title",
        descKey: "sector_admin_desc",
        agency: "МЕУ",
        to: "/sector/administration",
        accent: TILE_ACCENTS.indigo,
      },
    ],
  },
  {
    labelKey: "sectors_cluster_security",
    sectors: [
      {
        id: "defense",
        titleKey: "sector_defense_title",
        descKey: "sector_defense_desc",
        agency: "МО",
        to: "/defense",
        accent: TILE_ACCENTS.moss,
      },
      {
        id: "security",
        titleKey: "sector_security_title",
        descKey: "sector_security_desc",
        agency: "МВР",
        to: "/sector/security",
        accent: TILE_ACCENTS.slate,
      },
      {
        id: "justice",
        titleKey: "sector_justice_title",
        descKey: "sector_justice_desc",
        agency: "ВСС",
        to: "/judiciary",
        accent: TILE_ACCENTS.plum,
      },
    ],
  },
  {
    labelKey: "sectors_cluster_land",
    sectors: [
      {
        id: "agri",
        titleKey: "sector_agri_title",
        descKey: "sector_agri_desc",
        agency: "ДФЗ",
        to: "/sector/agri",
        accent: TILE_ACCENTS.gold,
      },
      {
        id: "culture",
        titleKey: "sector_culture_title",
        descKey: "sector_culture_desc",
        agency: "НФЦ",
        to: "/culture",
        accent: TILE_ACCENTS.terracotta,
      },
      {
        id: "tourism",
        titleKey: "sector_tourism_title",
        descKey: "sector_tourism_desc",
        agency: "МТ",
        to: "/sector/tourism",
        accent: TILE_ACCENTS.aqua,
      },
    ],
  },
];

export const SECTORS: Sector[] = SECTOR_CLUSTERS.flatMap((c) => c.sectors);

// The procurement-DOMINANT sectors, surfaced directly on the /procurement hub as
// a "featured" strip (the rest — and the payout/subsidy sectors — are one click
// away via the "all sectors" link to the cross-cutting /governance/sectors hub).
// Trimmed to sectors where public procurement is the primary money lens; the
// payout/subsidy/tax sectors (health=НЗОК, agri=ДФЗ, revenue=НАП) were dropped
// because their headline money is not procurement and reads misleadingly here.
export const FEATURED_SECTOR_IDS = [
  "roads",
  "defense",
  "energy",
  "water",
] as const;

export const FEATURED_SECTORS: Sector[] = FEATURED_SECTOR_IDS.map(
  (id) => SECTORS.find((s) => s.id === id)!,
).filter(Boolean);
