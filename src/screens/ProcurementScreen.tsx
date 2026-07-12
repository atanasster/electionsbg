// /procurement — the public-procurement HUB. A navigation-first landing: the
// combined search up top, the headline KPIs, then a tile grid that fronts every
// sub-page (overview analytics, contracts, tenders, appeals, NGOs, by-place,
// risk, watchlist) and a "featured sectors" strip into the sector dashboards.
// The deep analytics that used to live here moved to /procurement/overview
// (reached via the "Обзор" tile). Layout reuses the infographic tile-hub kit.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import {
  TileHubGrid,
  TileHubSection,
  InfographicTile,
  InfographicTileProps,
  TILE_ACCENTS,
} from "@/ux/infographic";
import { ProcurementScopeControl } from "./components/procurement/ProcurementScopeControl";
import { ProcurementSearchTile } from "./components/procurement/ProcurementSearchTile";
import { ProcurementKpiRow } from "./components/procurement/ProcurementKpiRow";
import { WatchlistDigestTile } from "./components/procurement/WatchlistDigestTile";
import { useProcurementOverview } from "@/data/procurement/useProcurementOverview";
import { PROCUREMENT_SCENES } from "./procurement/procurementScenes";
import { FEATURED_SECTORS } from "./governance/sectorRegistry";
import { SECTOR_SCENES } from "./governance/sectorScenes";

const numFmt = new Intl.NumberFormat("bg-BG");

// One entry per procurement sub-page. `descKey` is the fallback line; the
// contracts tile swaps in a live count when the overview payload is loaded.
const SUBPAGES = [
  {
    id: "analysis",
    titleKey: "procurement_overview_nav",
    descKey: "procurement_hub_analysis_desc",
    to: "/procurement/overview",
    accent: TILE_ACCENTS.brass,
  },
  {
    id: "contracts",
    titleKey: "procurement_index_contracts",
    descKey: "procurement_hub_contracts_desc",
    to: "/procurement/contracts",
    accent: TILE_ACCENTS.clay,
  },
  {
    id: "tenders",
    titleKey: "procurement_tenders_nav",
    descKey: "procurement_hub_tenders_desc",
    to: "/procurement/tenders",
    accent: TILE_ACCENTS.azure,
  },
  {
    id: "appeals",
    titleKey: "procurement_appeals_nav",
    descKey: "procurement_hub_appeals_desc",
    to: "/procurement/appeals",
    accent: TILE_ACCENTS.plum,
  },
  {
    id: "ngos",
    titleKey: "procurement_ngos_nav",
    descKey: "procurement_hub_ngos_desc",
    to: "/procurement/ngos",
    accent: TILE_ACCENTS.green,
  },
  {
    id: "place",
    titleKey: "procurement_by_settlement_nav",
    descKey: "procurement_hub_place_desc",
    to: "/procurement/by-settlement",
    accent: TILE_ACCENTS.teal,
  },
  {
    id: "risk",
    titleKey: "flags_nav",
    descKey: "procurement_hub_risk_desc",
    to: "/procurement/flags",
    accent: TILE_ACCENTS.rose,
  },
  {
    id: "watch",
    titleKey: "watchlist_nav",
    descKey: "procurement_hub_watch_desc",
    to: "/procurement/watchlist",
    accent: TILE_ACCENTS.amber,
  },
] as const;

export const ProcurementScreen: FC = () => {
  const { t } = useTranslation();
  const { data } = useProcurementOverview();
  const contractsTotal = data
    ? data.totals.contracts + data.totals.amendments
    : null;
  const title = t("procurement_index_title") || "Public procurement";

  const exploreTiles: InfographicTileProps[] = SUBPAGES.map((p) => ({
    to: p.to,
    title: t(p.titleKey),
    desc:
      p.id === "contracts" && contractsTotal != null
        ? t("procurement_hub_contracts_count", {
            n: numFmt.format(contractsTotal),
          })
        : t(p.descKey),
    accent: p.accent,
    scene: PROCUREMENT_SCENES[p.id],
  }));

  const exploreSection: TileHubSection = {
    heading: t("procurement_hub_explore") || "Explore",
    tiles: exploreTiles,
  };

  return (
    <>
      <Title description="Aggregated public-procurement contracts from data.egov.bg">
        {title}
      </Title>

      <div className="my-3">
        <ProcurementScopeControl mode="toggle" />
      </div>

      <ProcurementSearchTile />
      <div className="my-4">
        <ProcurementKpiRow />
      </div>
      <WatchlistDigestTile />

      <TileHubGrid sections={[exploreSection]} className="mt-8" />

      {/* Featured sectors — the highest-spend entities surfaced directly, with a
          link to the full 15-sector hub for the rest. */}
      <div className="mt-8">
        <div className="mb-3 flex items-center gap-3 sm:mb-4">
          <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
            {t("procurement_hub_sectors") || "Sectors"}
          </h2>
          <span
            aria-hidden
            className="h-px flex-1 bg-gradient-to-r from-border to-transparent"
          />
          <Link
            to="/governance/sectors"
            className="whitespace-nowrap text-xs font-semibold text-primary hover:underline"
          >
            {t("procurement_hub_all_sectors") || "All sectors →"}
          </Link>
        </div>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
          {FEATURED_SECTORS.map((s) => (
            <InfographicTile
              key={s.id}
              to={s.to}
              title={t(s.titleKey)}
              badge={s.agency}
              desc={t(s.descKey)}
              accent={s.accent}
              scene={SECTOR_SCENES[s.id]}
              cta={t("sectors_hub_view") || "виж сектора"}
            />
          ))}
        </div>
      </div>
    </>
  );
};
