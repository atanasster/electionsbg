// /governance/sectors — the "Държавни сектори" hub.
//
// A single visual entry point to every government-entity dashboard, replacing
// the 15-row "Държавни структури" column that used to bloat the управление
// dropdown. This screen is now just DATA over the reusable infographic tile-hub
// kit (src/ux/infographic): a sector registry → TileHubGrid. Each tile routes to
// the sector's existing home (an awarder pack /awarder/:eik or a standalone
// dashboard like /water, /judiciary, /defense); no per-sector data is fetched, so
// the hub stays instant.
//
// Транспорт (МТС) and Администрация (МЕУ) point at their awarder seats for now;
// when the planned /transport and /administration dashboards ship, repoint the
// two `to` fields (the same way water/defense graduated from awarder page to
// standalone view). See docs/plans/{transport,administration}-view-v1.md.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { TileHubGrid, TileHubSection, TILE_ACCENTS } from "@/ux/infographic";
import {
  ROADS_AWARDER_PATH,
  NOI_AWARDER_PATH,
  NZOK_AWARDER_PATH,
  MON_AWARDER_PATH,
  DFZ_AWARDER_PATH,
} from "@/screens/components/procurement/sectorPacks";
import { SECTOR_SCENES } from "./sectorScenes";

// Awarder seats given by EIK rather than a sectorPacks path export, so this hub
// stays self-contained: the two revenue collectors (НАП/Митници) plus the two
// sectors whose standalone view isn't built yet (Транспорт → /transport,
// Администрация → /administration). All four are real awarder pages today;
// repoint to the standalone dashboards when they ship (as water/defense did).
const NAP_AWARDER_PATH = "/awarder/131063188"; // НАП
const CUSTOMS_AWARDER_PATH = "/awarder/000627597"; // Агенция „Митници"
const TRANSPORT_AWARDER_PATH = "/awarder/000695388"; // МТС
const ADMIN_AWARDER_PATH = "/awarder/180680495"; // МЕУ

interface Sector {
  id: string; // scene key (SECTOR_SCENES)
  titleKey: string;
  descKey: string;
  agency: string; // Cyrillic acronym — same in both languages
  to: string;
  accent: string; // a TILE_ACCENTS token
}

const CLUSTERS: { labelKey: string; sectors: Sector[] }[] = [
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

export const GovernanceSectorsScreen: FC = () => {
  const { t } = useTranslation();
  const title = t("sectors_hub_title") || "Държавни сектори";
  const cta = t("sectors_hub_view") || "виж сектора";

  const sections: TileHubSection[] = CLUSTERS.map((cluster) => ({
    heading: t(cluster.labelKey),
    tiles: cluster.sectors.map((s) => ({
      to: s.to,
      title: t(s.titleKey),
      badge: s.agency,
      desc: t(s.descKey),
      accent: s.accent,
      scene: SECTOR_SCENES[s.id],
      cta,
    })),
  }));

  return (
    <>
      <Title
        description={
          t("sectors_hub_seo_description") ||
          "Всичко, което държавата харчи и решава — по сектори: пътища, здравна каса, пенсии, отбрана, правосъдие и още."
        }
      >
        {title}
      </Title>
      <p className="mx-auto -mt-2 max-w-[62ch] text-center text-sm text-muted-foreground sm:text-base">
        {t("sectors_hub_lede") ||
          "Един вход към всяка държавна структура — пари, договори, отговорни институции."}
      </p>

      <TileHubGrid sections={sections} className="my-6 sm:my-8" />
    </>
  );
};
