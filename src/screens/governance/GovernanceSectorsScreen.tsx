// /governance/sectors — the "Държавни сектори" hub.
//
// A single visual entry point to every government-entity dashboard, replacing
// the 15-row "Държавни структури" column that used to bloat the управление
// dropdown. Data comes from the shared sectorRegistry; layout from the reusable
// infographic tile-hub kit (src/ux/infographic). Each tile overlays the sector's
// all-time procurement € from the pre-generated sector_stats.json (one fetch),
// then routes to the sector's existing home.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { TileHubGrid, TileHubSection } from "@/ux/infographic";
import { SectorBreadcrumb } from "@/screens/components/procurement/SectorBreadcrumb";
import { ScopeControl } from "@/screens/components/ScopeControl";
import {
  useSectorStats,
  formatSectorMetric,
} from "@/data/procurement/useSectorStats";
import { SECTOR_CLUSTERS } from "./sectorRegistry";
import { SECTOR_SCENES } from "./sectorScenes";

export const GovernanceSectorsScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const stats = useSectorStats();
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
      metric: formatSectorMetric(stats?.[s.id], i18n.language),
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
      <SectorBreadcrumb className="mt-5" />

      <div className="my-3">
        <ScopeControl mode="toggle" />
      </div>

      <div data-og="sectors-hub">
        <TileHubGrid sections={sections} className="mt-4 sm:mt-6" />
      </div>
    </>
  );
};
