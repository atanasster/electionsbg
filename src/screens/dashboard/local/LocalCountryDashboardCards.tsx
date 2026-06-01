// Country-level local-elections dashboard (the /local/:cycle overview body).
// Stacked dashboard sections (no tabs, homepage shell): stat header, both the
// mayoral + council choropleths, mayor leaderboards, council leaderboards,
// cross-cycle trends, and recent extraordinary elections. The município
// directory is intentionally dropped here — navigation is map → region →
// município, plus global search; the full A-Z list lives on the region page.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useLocalElectionIndex } from "@/data/local/useLocalElectionIndex";
import { useLocalNationalLeaders } from "@/data/local/useLocalNationalLeaders";
import {
  PartyChip,
  RankedBar,
} from "@/screens/components/local/LocalRankedBar";
import { StatCard } from "../StatCard";
import { DashboardSection } from "../DashboardSection";
import { LocalRegionsControlMapTile } from "./LocalRegionsControlMapTile";
import { LocalRegionsTable } from "./LocalRegionsTable";
import {
  LocalTopMayorsTile,
  LocalClosestRacesTile,
  LocalSplitControlTile,
} from "./LocalLeaderTiles";
import { LocalCrossCycleTile } from "./LocalCrossCycleTile";
import { LocalExtraordinaryTile } from "./LocalExtraordinaryTile";
import { LocalDemographicCleavagesTile } from "./LocalDemographicCleavagesTile";
import { LocalVoteFlowTile } from "./LocalVoteFlowTile";
import { LocalCouncilControlTile } from "./LocalCouncilControlTile";

const isSofiaRayon = (code: string): boolean => /^S2\d{3}$/.test(code);

// Number of oblasti shown in the dashboard tile before the "see details" link
// opens the full table on /local/:cycle/regions.
const REGION_TILE_LIMIT = 8;

// Shared cap for list-style tiles so a long leaderboard doesn't tower over its
// grid-row neighbour on a desktop viewport (internal scroll past this height).
const LIST_MAX_H = "24rem";

export const LocalCountryDashboardCards: FC<{ cycle: string }> = ({
  cycle,
}) => {
  const { t } = useTranslation();
  const { data: index } = useLocalElectionIndex(cycle);
  const { data: leaders } = useLocalNationalLeaders(cycle);

  const realMunis = useMemo(
    () =>
      (index?.municipalities ?? []).filter(
        (m) => !isSofiaRayon(m.obshtinaCode),
      ),
    [index],
  );
  const municipalityCount = realMunis.length;
  const runoffCount = useMemo(
    () => realMunis.filter((m) => m.hadRound2).length,
    [realMunis],
  );

  const topMayors = useMemo(
    () => (index ? index.mayorsByCanonical.slice(0, 8) : []),
    [index],
  );
  const totalMayors = useMemo(
    () => index?.mayorsByCanonical.reduce((a, x) => a + x.count, 0) ?? 0,
    [index],
  );
  const topMayorLeader = topMayors[0]?.count ?? 0;
  const topCouncil = useMemo(
    () => (index ? index.councilVoteShare.slice(0, 10) : []),
    [index],
  );
  const topCouncilLeader = topCouncil[0]?.totalVotes ?? 0;

  if (!index) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("local_election_no_data")}
      </p>
    );
  }

  return (
    <div>
      {/* Stat header */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-3">
        <StatCard label={t("local_national_top_mayor_party")}>
          {topMayors[0] ? (
            <PartyChip
              name={topMayors[0].displayName}
              color={topMayors[0].color}
              suffix={t("local_region_mayors_count", {
                count: topMayors[0].count,
              })}
            />
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </StatCard>
        <StatCard label={t("local_national_top_council_party")}>
          {topCouncil[0] ? (
            <PartyChip
              name={topCouncil[0].displayName}
              color={topCouncil[0].color}
              suffix={`${topCouncil[0].pctOfValid.toFixed(1)}%`}
            />
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </StatCard>
        <StatCard
          label={t("local_national_municipalities")}
          to={`/local/${cycle}/municipalities`}
        >
          <span className="text-base font-semibold tabular-nums">
            {municipalityCount}
          </span>
        </StatCard>
        <StatCard
          label={t("local_national_runoffs")}
          to={`/local/${cycle}/runoffs`}
        >
          <span className="text-base font-semibold tabular-nums">
            {runoffCount}
          </span>
        </StatCard>
        <StatCard
          label={t("local_national_split_control")}
          to={`/local/${cycle}/split-control`}
        >
          <span className="text-base font-semibold tabular-nums">
            {leaders ? leaders.splitControl.count : "—"}
          </span>
        </StatCard>
        <StatCard
          label={t("local_national_independents")}
          to={`/local/${cycle}/independents`}
        >
          <span className="text-base font-semibold tabular-nums">
            {leaders ? leaders.independentMayors.count : "—"}
          </span>
        </StatCard>
      </div>

      {/* Maps: mayoral control + council support, side by side. */}
      <DashboardSection id="local-maps" title={t("local_sec_maps")}>
        <div className="grid gap-4 lg:grid-cols-2">
          <LocalRegionsControlMapTile cycle={cycle} metric="mayor" />
          <LocalRegionsControlMapTile cycle={cycle} metric="council" />
        </div>
        <LocalRegionsTable cycle={cycle} limit={REGION_TILE_LIMIT} />
      </DashboardSection>

      {/* Mayors: who governs. The bar-list summary pairs with the strongest-
          mandates leaderboard (both height-capped so the row stays balanced);
          the closest-races leaderboard sits full-width below — mirroring the
          councils section's full-width demographic-cleavages tile, and avoiding
          a 3-into-2 grid that would leave a ragged empty cell. */}
      <DashboardSection id="local-mayors" title={t("local_sec_mayors")}>
        <div className="grid gap-4 lg:grid-cols-2">
          <StatCard
            titleCase
            bodyMaxHeight={LIST_MAX_H}
            label={t("local_cycle_overview_mayors_section")}
          >
            <ul>
              {topMayors.map((p) => (
                <RankedBar
                  key={p.canonicalId}
                  label={p.displayName}
                  value={p.count}
                  pct={totalMayors > 0 ? (p.count / totalMayors) * 100 : 0}
                  leaderValue={topMayorLeader}
                  color={p.color}
                />
              ))}
            </ul>
          </StatCard>
          <LocalTopMayorsTile cycle={cycle} bodyMaxHeight={LIST_MAX_H} />
        </div>
        <LocalClosestRacesTile cycle={cycle} bodyMaxHeight={LIST_MAX_H} />
      </DashboardSection>

      {/* Councils: the proportional party signal. */}
      <DashboardSection id="local-councils" title={t("local_sec_councils")}>
        <LocalCouncilControlTile cycle={cycle} />
        <div className="grid gap-4 lg:grid-cols-2">
          <StatCard
            titleCase
            bodyMaxHeight={LIST_MAX_H}
            label={t("local_cycle_overview_council_section")}
          >
            <ul>
              {topCouncil.map((p) => (
                <RankedBar
                  key={p.canonicalId}
                  label={p.displayName}
                  value={p.totalVotes}
                  pct={p.pctOfValid}
                  leaderValue={topCouncilLeader}
                  color={p.color}
                />
              ))}
            </ul>
          </StatCard>
          <LocalSplitControlTile cycle={cycle} bodyMaxHeight={LIST_MAX_H} />
        </div>
        {/* How each leading council party's vote correlates with the
            municipality's demographics. */}
        <LocalDemographicCleavagesTile cycle={cycle} />
      </DashboardSection>

      {/* Estimated council vote flow vs the previous cycle. */}
      <DashboardSection id="local-flows" title={t("local_sec_flows")}>
        <LocalVoteFlowTile cycle={cycle} />
      </DashboardSection>

      {/* Cross-cycle trends. The grid wrapper gives the tile a definite-width
          track so its ResponsiveContainer chart can't collapse during reflow —
          a lone flex child has no width floor once the chart is the only
          content (matches how the other dashboard chart tiles are wrapped). */}
      <DashboardSection id="local-trends" title={t("local_sec_trends")}>
        <div className="grid gap-4">
          <LocalCrossCycleTile />
        </div>
      </DashboardSection>

      {/* Extraordinary elections. */}
      <DashboardSection
        id="local-extraordinary"
        title={t("local_sec_extraordinary")}
      >
        <LocalExtraordinaryTile />
      </DashboardSection>
    </div>
  );
};
