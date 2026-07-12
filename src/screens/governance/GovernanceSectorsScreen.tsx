// /governance/sectors — the "Държавни сектори" hub.
//
// A single visual entry point to every government-entity dashboard, replacing
// the 15-row "Държавни структури" column that used to bloat the управление
// dropdown. Data comes from the shared sectorRegistry; layout from the reusable
// infographic tile-hub kit (src/ux/infographic). Each tile routes to the
// sector's existing home; no per-sector data is fetched, so the hub stays
// instant.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { TileHubGrid, TileHubSection } from "@/ux/infographic";
import { SectorBreadcrumb } from "@/screens/components/procurement/SectorBreadcrumb";
import { SECTOR_CLUSTERS } from "./sectorRegistry";
import { SECTOR_SCENES } from "./sectorScenes";

export const GovernanceSectorsScreen: FC = () => {
  const { t } = useTranslation();
  const title = t("sectors_hub_title") || "Държавни сектори";
  const cta = t("sectors_hub_view") || "виж сектора";

  const sections: TileHubSection[] = SECTOR_CLUSTERS.map((cluster) => ({
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

      <SectorBreadcrumb className="mt-5" />

      <TileHubGrid sections={sections} className="my-4 sm:my-6" />
    </>
  );
};
