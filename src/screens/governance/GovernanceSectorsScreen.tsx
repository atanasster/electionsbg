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
import { Link } from "react-router-dom";
import { usePreserveParams } from "@/ux/usePreserveParams";
import { Title } from "@/ux/Title";
import { TileHubGrid, TileHubSection } from "@/ux/infographic";
import { SectorBreadcrumb } from "@/screens/components/procurement/SectorBreadcrumb";
import { ScopeControl } from "@/screens/components/ScopeControl";
import {
  useSectorStats,
  formatSectorMetric,
  sectorMetricCaption,
  scopeProcurementPeriod,
} from "@/data/procurement/useSectorStats";
import { useScopeWindow } from "@/data/scope/useScopeWindow";
import { SECTOR_CLUSTERS } from "./sectorRegistry";
import { SECTOR_SCENES } from "./sectorScenes";

export const GovernanceSectorsScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const stats = useSectorStats();
  const win = useScopeWindow();
  const period = scopeProcurementPeriod(win);
  const searchParams = usePreserveParams();
  // Carry ?pscope across to the methodology page, like every other in-app link.
  const linkTo = (path: string) => {
    const merged = searchParams().toString();
    return merged ? `${path}?${merged}` : path;
  };
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
      metricCaption: sectorMetricCaption(stats?.[s.id], t, period, win.year),
    })),
  }));

  return (
    <>
      <Title
        description={
          t("sectors_hub_seo_description") ||
          "Всичко, което държавата харчи и решава — по сектори: пътища, здравеопазване, пенсии, отбрана, правосъдие и още."
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

      {/* The unit-cost family's shared methodology (plan §3). Three sector tiles
          — courts €/case, roads €/km, health €/case — compute the same KIND of
          number, and each used to restate its caveat in its own words. This is
          the one place the rules live; the tiles link back to it.

          Deliberately a NAVIGATIONAL index, not a scoreboard: §3b rules out a
          composite efficiency index because the three units are not
          commensurable, and restating three live figures here would be a fourth
          copy that goes stale — the drift the plan flags for hub_stats. Each
          figure stays where it is computed. */}
      <div className="mt-6 rounded-lg border border-border/60 bg-muted/30 p-4">
        <h2 className="text-sm font-semibold">
          {t("unit_cost_hub_heading") || "Цена за единица резултат"}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("unit_cost_hub_blurb") ||
            "Разход за свършено дело, цена на километър, разход за болничен случай — едно и също по вид число на три места. Какво измерва и какво не."}
        </p>
        <Link
          to={linkTo("/governance/sectors/methodology")}
          className="mt-2 inline-block text-xs font-medium text-primary hover:underline"
        >
          {t("unit_cost_hub_cta") || "Методология"} →
        </Link>
      </div>
    </>
  );
};
