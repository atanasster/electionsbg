// /procurement — the public-procurement HUB. A navigation-first landing: the
// combined search up top, then a tile grid that fronts every sub-page (overview
// analytics, contracts, contractors, connected people, tenders, appeals, NGOs,
// by-place, risk, watchlist) and a "featured sectors" strip into the sector
// dashboards. The headline numbers are overlaid on the tiles themselves (no
// separate KPI cards). The deep analytics that used to live here moved to
// /procurement/overview (reached via the "Обзор" tile). Reuses the tile-hub kit.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import {
  TileHubGrid,
  TileHubSection,
  InfographicTileProps,
  FeaturedStrip,
  TILE_ACCENTS,
} from "@/ux/infographic";
import { ScopeControl } from "./components/ScopeControl";
import { GovernanceBreadcrumb } from "./components/GovernanceBreadcrumb";
import { ProcurementSearchTile } from "./components/procurement/ProcurementSearchTile";
import { WatchlistDigestTile } from "./components/procurement/WatchlistDigestTile";
import { useProcurementHubStats } from "@/data/procurement/useProcurementHubStats";
import {
  useSectorStats,
  formatSectorMetric,
  sectorMetricCaption,
  scopeProcurementPeriod,
} from "@/data/procurement/useSectorStats";
import { useScopeWindow } from "@/data/scope/useScopeWindow";
import { useWatchlist } from "@/data/procurement/useWatchlist";
import { formatEurCompact } from "@/lib/currency";
import { PROCUREMENT_SCENES } from "./procurement/procurementScenes";
import { FEATURED_SECTORS } from "./governance/sectorRegistry";
import { SECTOR_SCENES } from "./governance/sectorScenes";

const numFmt = new Intl.NumberFormat("bg-BG");

// One entry per procurement sub-page. `metric` names the headline number the
// tile overlays (resolved from the overview payload / the watchlist), replacing
// the separate KPI cards; tiles without one stay descriptor-only until their
// count is pre-generated (tenders/appeals/NGOs/flags need the overview SQL fn
// extended).
const SUBPAGES = [
  {
    id: "analysis",
    titleKey: "procurement_overview_nav",
    descKey: "procurement_hub_analysis_desc",
    to: "/procurement/overview",
    accent: TILE_ACCENTS.brass,
    metric: "total",
  },
  {
    id: "contracts",
    titleKey: "procurement_index_contracts",
    descKey: "procurement_hub_contracts_desc",
    to: "/procurement/contracts",
    accent: TILE_ACCENTS.clay,
    metric: "contracts",
  },
  {
    id: "contractors",
    titleKey: "procurement_index_contractors",
    descKey: "procurement_hub_contractors_desc",
    to: "/procurement/contractors",
    accent: TILE_ACCENTS.steel,
    metric: "contractors",
  },
  {
    id: "connected",
    titleKey: "procurement_index_connected",
    descKey: "procurement_hub_connected_desc",
    to: "/procurement/mps",
    accent: TILE_ACCENTS.amber,
    metric: "connected",
  },
  {
    id: "tenders",
    titleKey: "procurement_tenders_nav",
    descKey: "procurement_hub_tenders_desc",
    to: "/procurement/tenders",
    accent: TILE_ACCENTS.azure,
    metric: "tenders",
  },
  {
    id: "appeals",
    titleKey: "procurement_appeals_nav",
    descKey: "procurement_hub_appeals_desc",
    to: "/procurement/appeals",
    accent: TILE_ACCENTS.plum,
    metric: "appeals",
  },
  {
    id: "ngos",
    titleKey: "procurement_ngos_nav",
    descKey: "procurement_hub_ngos_desc",
    to: "/procurement/ngos",
    accent: TILE_ACCENTS.green,
    metric: "ngos",
  },
  {
    id: "place",
    titleKey: "procurement_by_settlement_nav",
    descKey: "procurement_hub_place_desc",
    to: "/procurement/by-settlement",
    accent: TILE_ACCENTS.teal,
    metric: "places",
  },
  {
    id: "risk",
    titleKey: "flags_nav",
    descKey: "procurement_hub_risk_desc",
    to: "/procurement/flags",
    accent: TILE_ACCENTS.rose,
    metric: "flags",
  },
  {
    id: "watch",
    titleKey: "watchlist_nav",
    descKey: "procurement_hub_watch_desc",
    to: "/procurement/watchlist",
    accent: TILE_ACCENTS.gold,
    metric: "watch",
  },
] as const;

export const ProcurementScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const stat = useProcurementHubStats();
  const sectorStats = useSectorStats();
  const sectorPeriod = scopeProcurementPeriod(useScopeWindow());
  const watchCount = useWatchlist().length;
  const title = t("procurement_index_title") || "Public procurement";

  // Numbers come from the pre-generated per-scope hub_stats.json (one fetch),
  // except the watchlist count which is local. `total` is the euro headline;
  // everything else is a plain count.
  const metricFor = (m?: string): string | undefined => {
    if (m === "watch")
      return watchCount > 0 ? numFmt.format(watchCount) : undefined;
    if (!m || !stat) return undefined;
    if (m === "total") return formatEurCompact(stat.totalEur, i18n.language);
    const counts: Record<string, number | undefined> = {
      contracts: stat.contracts,
      contractors: stat.contractors,
      connected: stat.connected,
      tenders: stat.tenders,
      appeals: stat.appeals,
      ngos: stat.ngos,
      places: stat.places,
      flags: stat.flags,
    };
    const v = counts[m];
    return v != null ? numFmt.format(v) : undefined;
  };

  const bg = i18n.language === "bg";
  const exploreTiles: InfographicTileProps[] = [
    ...SUBPAGES.map((p) => ({
      to: p.to,
      title: t(p.titleKey),
      desc: t(p.descKey),
      accent: p.accent,
      scene: PROCUREMENT_SCENES[p.id],
      metric: metricFor("metric" in p ? p.metric : undefined),
    })),
    // The project-file builder on-ramp (§4.3b). Bilingual-inline (no i18n key);
    // reuses the document "досие" scene, a distinct accent, no headline number.
    {
      to: "/procurement/project",
      title: bg ? "Проектни досиета" : "Project files",
      desc: bg
        ? "Проследи един проект през поръчките"
        : "Track one project across procurement",
      accent: TILE_ACCENTS.indigo,
      scene: PROCUREMENT_SCENES.contracts,
    },
  ];

  const exploreSection: TileHubSection = {
    heading: t("procurement_hub_explore") || "Explore",
    tiles: exploreTiles,
  };

  return (
    <>
      <Title description="Aggregated public-procurement contracts from data.egov.bg">
        {title}
      </Title>
      <GovernanceBreadcrumb
        sectionKey="procurement_link_label"
        sectionTo="/procurement"
        className="mt-5"
      />

      <div className="my-3">
        <ScopeControl mode="toggle" />
      </div>

      <ProcurementSearchTile />
      <WatchlistDigestTile />

      <div data-og="procurement-hub">
        <TileHubGrid sections={[exploreSection]} className="mt-6" />
      </div>

      {/* Featured sectors — the highest-spend entities surfaced directly, with a
          link to the full 15-sector hub for the rest. */}
      <FeaturedStrip
        className="mt-8"
        heading={t("procurement_hub_sectors") || "Sectors"}
        action={{
          to: "/governance/sectors",
          label: t("procurement_hub_all_sectors") || "All sectors →",
        }}
        tiles={FEATURED_SECTORS.map((s) => ({
          to: s.to,
          title: t(s.titleKey),
          badge: s.agency,
          desc: t(s.descKey),
          accent: s.accent,
          scene: SECTOR_SCENES[s.id],
          cta: t("sectors_hub_view") || "виж сектора",
          metric: formatSectorMetric(sectorStats?.[s.id], i18n.language),
          metricCaption: sectorMetricCaption(
            sectorStats?.[s.id],
            t,
            sectorPeriod,
          ),
        }))}
      />
    </>
  );
};
