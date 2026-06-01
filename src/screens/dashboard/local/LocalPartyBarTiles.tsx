// Country-dashboard party ranked-bar tiles, both driven by the per-cycle
// index.json:
//   LocalMayorsByPartyTile — elected mayors won per canonical party
//   LocalCouncilVotesTile   — council (общински съветници) vote share, round 1
// Each runs dual-mode like LocalRegionsTable: a top-N preview with a "see
// details →" link when `limit`+`seeMoreTo` are set, else the full ranked list
// (the standalone /local/:cycle/{mayors-by-party,council-votes} pages).

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { useLocalElectionIndex } from "@/data/local/useLocalElectionIndex";
import { RankedBar } from "@/screens/components/local/LocalRankedBar";
import { StatCard } from "../StatCard";

export const LocalMayorsByPartyTile: FC<{
  cycle: string;
  limit?: number;
  seeMoreTo?: string;
}> = ({ cycle, limit, seeMoreTo }) => {
  const { t } = useTranslation();
  const { data: index } = useLocalElectionIndex(cycle);
  const allRows = index?.mayorsByCanonical ?? [];
  if (allRows.length === 0) return null;
  const rows = limit != null ? allRows.slice(0, limit) : allRows;
  const total = allRows.reduce((a, x) => a + x.count, 0);
  const leaderValue = allRows[0]?.count ?? 0;
  return (
    <StatCard
      seeMoreTo={seeMoreTo}
      label={t("local_cycle_overview_mayors_section")}
    >
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

export const LocalCouncilVotesTile: FC<{
  cycle: string;
  limit?: number;
  seeMoreTo?: string;
}> = ({ cycle, limit, seeMoreTo }) => {
  const { t } = useTranslation();
  const { data: index } = useLocalElectionIndex(cycle);
  const allRows = index?.councilVoteShare ?? [];
  if (allRows.length === 0) return null;
  const rows = limit != null ? allRows.slice(0, limit) : allRows;
  const leaderValue = allRows[0]?.totalVotes ?? 0;
  return (
    <StatCard
      seeMoreTo={seeMoreTo}
      label={t("local_cycle_overview_council_section")}
    >
      <ul>
        {rows.map((p) => (
          <RankedBar
            key={p.canonicalId}
            label={p.displayName}
            value={p.totalVotes}
            pct={p.pctOfValid}
            leaderValue={leaderValue}
            color={p.color}
          />
        ))}
      </ul>
    </StatCard>
  );
};
