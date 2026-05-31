// Sofia-city shortcut for the national local-elections maps.
//
// Mirrors the parliamentary SofiaCity tile: a skyline silhouette pinned to the
// map's bottom-left corner, filled by the leading party's colour, that links
// straight to Sofia's city-wide bundle (/local/:cycle/SOF). Sofia is a single
// tiny polygon on the oblast map (and a synthetic SOF entity), so it's awkward
// to hit by click — this gives it a dedicated, discoverable entry point.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "@/ux/Link";
import { Tooltip } from "@/ux/Tooltip";
import { MapCoordinates } from "@/layout/dataview/MapLayout";
import { useMediaQueryMatch } from "@/ux/useMediaQueryMatch";
import { SofiaSkyline } from "@/screens/components/regions/SofiaSkyline";
import { LocalRegionsSummaryRow } from "@/data/local/types";
import type { LocalMapMetric } from "./LocalRegionsControlMapTile";
import {
  LocalPartyBreakdownXS,
  LocalBreakdownRow,
} from "@/screens/components/local/LocalPartyBreakdownXS";

export const LocalSofiaCityLink: FC<{
  cycle: string;
  size: MapCoordinates;
  metric: LocalMapMetric;
  row?: LocalRegionsSummaryRow;
}> = ({ cycle, size, metric, row }) => {
  const { t } = useTranslation();
  const isXLarge = useMediaQueryMatch("xl");
  const isMedium = useMediaQueryMatch("md");
  const width = isXLarge ? 160 : isMedium ? 120 : 100;
  const height = 0.7 * width;
  const isMayor = metric === "mayor";

  const top = isMayor ? row?.topMayor : row?.topCouncil;

  const rows: LocalBreakdownRow[] = isMayor
    ? (row?.mayorsWon ?? []).map((p) => ({
        id: p.canonicalId,
        name: p.displayName,
        color: p.color,
        value: p.count,
      }))
    : (row?.councilSeats ?? []).map((p) => ({
        id: p.canonicalId,
        name: p.displayName,
        color: p.color,
        value: p.seats,
      }));
  const total = rows.reduce((a, r) => a + r.value, 0);
  const header = isMayor
    ? t("local_region_mayors_count", { count: total })
    : t("local_region_seats_count", { count: total });

  return (
    <Link
      to={{ pathname: `/local/${cycle}/SOF` }}
      aria-label={t("local_region_sofia_city")}
      style={{
        position: "absolute",
        left: 0,
        top: size[1] - height,
      }}
    >
      <Tooltip
        content={
          <div className="text-left">
            <div className="text-sm font-semibold text-center pb-1">
              {t("local_region_sofia_city")}
            </div>
            {rows.length ? (
              <LocalPartyBreakdownXS
                header={header}
                rows={rows}
                total={total}
              />
            ) : (
              <div className="text-xs opacity-70">
                {t("local_election_no_data")}
              </div>
            )}
          </div>
        }
      >
        <SofiaSkyline
          fillColor={top?.color}
          width={width}
          height={height}
          className="border-2 hover:border-muted-foreground rounded-xl p-1 bg-card"
        />
      </Tooltip>
    </Link>
  );
};
