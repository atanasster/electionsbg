// The government-sector registry — the single source of truth for the sector
// list, shared by the /governance/sectors hub (GovernanceSectorsScreen) and any
// other surface that fronts sectors (e.g. the "featured sectors" block on the
// /procurement hub). Pure data: the scene is referenced by `id`
// (SECTOR_SCENES[id]), so this module carries no JSX.
//
// Транспорт (МТС) and Администрация (МЕУ) point at their awarder seats until the
// planned /transport and /administration dashboards ship — repoint the two `to`
// fields then (as water/defense graduated). See docs/plans/*.

import { TILE_ACCENTS } from "@/ux/infographic";
import {
  ROADS_AWARDER_PATH,
  NOI_AWARDER_PATH,
  NZOK_AWARDER_PATH,
  MON_AWARDER_PATH,
  DFZ_AWARDER_PATH,
} from "@/screens/components/procurement/sectorPacks";

// Awarder seats given by EIK rather than a sectorPacks path export (the revenue
// collectors + the two not-yet-built standalone views).
const NAP_AWARDER_PATH = "/awarder/131063188"; // НАП
const CUSTOMS_AWARDER_PATH = "/awarder/000627597"; // Агенция „Митници"
const TRANSPORT_AWARDER_PATH = "/awarder/000695388"; // МТС
const ADMIN_AWARDER_PATH = "/awarder/180680495"; // МЕУ

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
        to: ROADS_AWARDER_PATH,
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
        to: TRANSPORT_AWARDER_PATH,
        accent: TILE_ACCENTS.steel,
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
        agency: "НОИ",
        to: NOI_AWARDER_PATH,
        accent: TILE_ACCENTS.olive,
      },
      {
        id: "health",
        titleKey: "sector_health_title",
        descKey: "sector_health_desc",
        agency: "НЗОК",
        to: NZOK_AWARDER_PATH,
        accent: TILE_ACCENTS.rose,
      },
      {
        id: "edu",
        titleKey: "sector_edu_title",
        descKey: "sector_edu_desc",
        agency: "МОН",
        to: MON_AWARDER_PATH,
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
        to: NAP_AWARDER_PATH,
        accent: TILE_ACCENTS.brass,
      },
      {
        id: "customs",
        titleKey: "sector_customs_title",
        descKey: "sector_customs_desc",
        agency: "АМ",
        to: CUSTOMS_AWARDER_PATH,
        accent: TILE_ACCENTS.azure,
      },
      {
        id: "administration",
        titleKey: "sector_admin_title",
        descKey: "sector_admin_desc",
        agency: "МЕУ",
        to: ADMIN_AWARDER_PATH,
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
        to: DFZ_AWARDER_PATH,
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
    ],
  },
];

export const SECTORS: Sector[] = SECTOR_CLUSTERS.flatMap((c) => c.sectors);

// The highest-spend sectors, surfaced directly on the /procurement hub as a
// "featured" strip (the rest are one click away via the "all sectors" link).
// Curated by procurement value; revisit if the corpus ordering shifts.
export const FEATURED_SECTOR_IDS = [
  "roads",
  "health",
  "defense",
  "water",
  "agri",
  "revenue",
] as const;

export const FEATURED_SECTORS: Sector[] = FEATURED_SECTOR_IDS.map(
  (id) => SECTORS.find((s) => s.id === id)!,
).filter(Boolean);
