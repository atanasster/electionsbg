// Region (oblast) dashboard party ranked-bar tiles, driven by the per-oblast
// rollup (region/<oblast>.json via useLocalRegion):
//   LocalRegionMayorsTile       — mayoralties won per party in the oblast
//   LocalRegionCouncilSeatsTile — council seats won per party in the oblast
// Dual-mode like LocalPartyBarTiles: a top-N preview with a "see details →"
// link when `limit`+`seeMoreTo` are set, else the full ranked list (the
// standalone /local/:cycle/region/:oblast/{mayors-by-party,council-seats}
// pages).

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { useLocalRegion } from "@/data/local/useLocalRegion";
import { RankedBar } from "@/screens/components/local/LocalRankedBar";
import { StatCard } from "../StatCard";

export const LocalRegionMayorsTile: FC<{
  cycle: string;
  oblast: string;
  limit?: number;
  seeMoreTo?: string;
}> = ({ cycle, oblast, limit, seeMoreTo }) => {
  const { t } = useTranslation();
  const { data: region } = useLocalRegion(oblast, cycle);
  const allRows = region?.mayorsWon ?? [];
  if (allRows.length === 0) return null;
  const rows = limit != null ? allRows.slice(0, limit) : allRows;
  const total = allRows.reduce((a, x) => a + x.count, 0);
  const leaderValue = allRows[0]?.count ?? 0;
  return (
    <StatCard seeMoreTo={seeMoreTo} label={t("local_region_mayors_section")}>
      <ul>
        {rows.map((p) => (
          <RankedBar
            key={p.canonicalId}
            label={p.displayName}
            value={p.count}
            pct={total > 0 ? (p.count / total) * 100 : 0}
            leaderValue={leaderValue}
            color={p.color}
          />
        ))}
      </ul>
    </StatCard>
  );
};

export const LocalRegionCouncilSeatsTile: FC<{
  cycle: string;
  oblast: string;
  limit?: number;
  seeMoreTo?: string;
}> = ({ cycle, oblast, limit, seeMoreTo }) => {
  const { t } = useTranslation();
  const { data: region } = useLocalRegion(oblast, cycle);
  const allRows = region?.councilSeats ?? [];
  if (allRows.length === 0) return null;
  const rows = limit != null ? allRows.slice(0, limit) : allRows;
  const total = allRows.reduce((a, x) => a + x.seats, 0);
  const leaderValue = allRows[0]?.seats ?? 0;
  return (
    <StatCard seeMoreTo={seeMoreTo} label={t("local_region_council_section")}>
      <ul>
        {rows.map((p) => (
          <RankedBar
            key={p.canonicalId}
            label={p.displayName}
            value={p.seats}
            pct={total > 0 ? (p.seats / total) * 100 : 0}
            leaderValue={leaderValue}
            color={p.color}
          />
        ))}
      </ul>
    </StatCard>
  );
};
