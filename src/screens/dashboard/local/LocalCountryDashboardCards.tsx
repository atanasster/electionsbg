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
import { PartyChip } from "@/screens/components/local/LocalRankedBar";
import { StatCard } from "../StatCard";
import { DashboardSection } from "../DashboardSection";
import { LocalRegionsControlMapTile } from "./LocalRegionsControlMapTile";
import { LocalRegionsTable } from "./LocalRegionsTable";
import {
  LocalMayorsByPartyTile,
  LocalCouncilVotesTile,
} from "./LocalPartyBarTiles";
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
import { LocalSwingTile } from "./LocalSwingTile";

const isSofiaRayon = (code: string): boolean => /^S2\d{3}$/.test(code);

// Number of oblasti shown in the dashboard tile before the "see details" link
// opens the full table on /local/:cycle/regions.
const REGION_TILE_LIMIT = 8;

// Rows shown in each list/bar tile before its "see details →" link opens the
// full standalone page. Small enough that paired tiles stay the same height
// and no tile scrolls internally.
const PREVIEW = 6;

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

  // Just the leader of each ranking — the full bar lists live in their own
  // tiles (LocalMayorsByPartyTile / LocalCouncilVotesTile) below.
  const topMayor = index?.mayorsByCanonical[0];
  const topCouncilParty = index?.councilVoteShare[0];

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
          {topMayor ? (
            <PartyChip
              name={topMayor.displayName}
              color={topMayor.color}
              suffix={t("local_region_mayors_count", {
                count: topMayor.count,
              })}
            />
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </StatCard>
        <StatCard label={t("local_national_top_council_party")}>
          {topCouncilParty ? (
            <PartyChip
              name={topCouncilParty.displayName}
              color={topCouncilParty.color}
              suffix={`${topCouncilParty.pctOfValid.toFixed(1)}%`}
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
          <LocalMayorsByPartyTile
            cycle={cycle}
            limit={PREVIEW}
            seeMoreTo={`/local/${cycle}/mayors-by-party`}
          />
          <LocalTopMayorsTile
            cycle={cycle}
            limit={PREVIEW}
            seeMoreTo={`/local/${cycle}/strongest-mandates`}
          />
        </div>
        <LocalClosestRacesTile
          cycle={cycle}
          limit={PREVIEW}
          seeMoreTo={`/local/${cycle}/closest-races`}
        />
        {/* How each leading party's first-round mayoral vote correlates with
            the municipality's demographics. */}
        <LocalDemographicCleavagesTile cycle={cycle} race="mayor" />
      </DashboardSection>

      {/* Councils: the proportional party signal. */}
      <DashboardSection id="local-councils" title={t("local_sec_councils")}>
        <LocalCouncilControlTile cycle={cycle} />
        <div className="grid gap-4 lg:grid-cols-2">
          <LocalCouncilVotesTile
            cycle={cycle}
            limit={PREVIEW}
            seeMoreTo={`/local/${cycle}/council-votes`}
          />
          <LocalSplitControlTile
            cycle={cycle}
            limit={PREVIEW}
            seeMoreTo={`/local/${cycle}/split-control`}
          />
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
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <LocalCrossCycleTile />
          <LocalSwingTile limit={PREVIEW} seeMoreTo={`/local/${cycle}/swing`} />
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
