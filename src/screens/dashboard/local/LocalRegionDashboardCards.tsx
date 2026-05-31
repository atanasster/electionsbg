// Region (oblast) local-elections dashboard — one fetch (region/<oblast>.json).
// Dashboard sections (no tabs): stat header, mayoral + council choropleths,
// mayor/council leaderboards, split-control list, and the full A-Z município
// directory (which the country page intentionally drops).

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { GitFork } from "lucide-react";
import { useLocalRegion } from "@/data/local/useLocalRegion";
import {
  PartyChip,
  RankedBar,
} from "@/screens/components/local/LocalRankedBar";
import { formatThousands } from "@/data/utils";
import { StatCard } from "../StatCard";
import { DashboardSection } from "../DashboardSection";
import { LocalRegionMapTile } from "./LocalRegionMapTile";
import { LocalVoteFlowTile } from "./LocalVoteFlowTile";

export const LocalRegionDashboardCards: FC<{
  cycle: string;
  oblast: string;
}> = ({ cycle, oblast }) => {
  const { t } = useTranslation();
  const { data: region, isLoading } = useLocalRegion(oblast, cycle);

  const totalMayors = useMemo(
    () => region?.mayorsWon.reduce((a, r) => a + r.count, 0) ?? 0,
    [region],
  );
  const totalCouncilSeats = useMemo(
    () => region?.councilSeats.reduce((a, r) => a + r.seats, 0) ?? 0,
    [region],
  );
  // Split control derives directly from the rollup: mayor's party vs the
  // município's leading council party.
  const splitRows = useMemo(
    () =>
      (region?.municipalities ?? []).filter(
        (m) =>
          m.electedMayor &&
          m.topCouncil &&
          m.electedMayor.canonicalId !== m.topCouncil.canonicalId,
      ),
    [region],
  );

  if (isLoading && !region) {
    return <p className="text-sm text-muted-foreground">{t("loading")}</p>;
  }
  if (!region) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("local_election_no_data")}
      </p>
    );
  }

  const topMayor = region.mayorsWon[0];
  const topCouncil = region.councilSeats[0];

  return (
    <div>
      {/* Stat header */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-3">
        <StatCard label={t("local_national_top_mayor_party")}>
          {topMayor ? (
            <PartyChip
              name={topMayor.displayName}
              color={topMayor.color}
              suffix={t("local_region_mayors_count", { count: topMayor.count })}
            />
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </StatCard>
        <StatCard label={t("local_national_top_council_party")}>
          {topCouncil ? (
            <PartyChip
              name={topCouncil.displayName}
              color={topCouncil.color}
              suffix={t("local_region_seats_count", {
                count: topCouncil.seats,
              })}
            />
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </StatCard>
        <StatCard
          label={t("local_national_municipalities")}
          to={`/local/${cycle}/region/${oblast}/municipalities`}
        >
          <span className="text-base font-semibold tabular-nums">
            {region.municipalityCount}
          </span>
        </StatCard>
        <StatCard
          label={t("local_national_runoffs")}
          to={`/local/${cycle}/region/${oblast}/runoffs`}
        >
          <span className="text-base font-semibold tabular-nums">
            {region.runoffCount}
          </span>
        </StatCard>
        <StatCard
          label={t("local_national_split_control")}
          to={`/local/${cycle}/region/${oblast}/split-control`}
        >
          <span className="text-base font-semibold tabular-nums">
            {splitRows.length}
          </span>
        </StatCard>
      </div>

      {/* Maps: mayoral control + council support. */}
      <DashboardSection id="local-maps" title={t("local_sec_maps")}>
        <div className="grid gap-4 lg:grid-cols-2">
          <LocalRegionMapTile cycle={cycle} oblast={oblast} metric="mayor" />
          <LocalRegionMapTile cycle={cycle} oblast={oblast} metric="council" />
        </div>
      </DashboardSection>

      {/* Mayors. */}
      <DashboardSection id="local-mayors" title={t("local_sec_mayors")}>
        {region.mayorsWon.length > 0 ? (
          <StatCard label={t("local_region_mayors_section")}>
            <ul>
              {region.mayorsWon.map((p) => (
                <RankedBar
                  key={p.canonicalId}
                  label={p.displayName}
                  value={p.count}
                  pct={totalMayors > 0 ? (p.count / totalMayors) * 100 : 0}
                  leaderValue={topMayor?.count ?? 0}
                  color={p.color}
                />
              ))}
            </ul>
          </StatCard>
        ) : null}
      </DashboardSection>

      {/* Councils + split control. */}
      <DashboardSection id="local-councils" title={t("local_sec_councils")}>
        <div className="grid gap-4 lg:grid-cols-2">
          {region.councilSeats.length > 0 ? (
            <StatCard label={t("local_region_council_section")}>
              <ul>
                {region.councilSeats.map((p) => (
                  <RankedBar
                    key={p.canonicalId}
                    label={p.displayName}
                    value={p.seats}
                    pct={
                      totalCouncilSeats > 0
                        ? (p.seats / totalCouncilSeats) * 100
                        : 0
                    }
                    leaderValue={topCouncil?.seats ?? 0}
                    color={p.color}
                  />
                ))}
              </ul>
            </StatCard>
          ) : null}
          {splitRows.length > 0 ? (
            <StatCard
              label={
                <div className="flex items-center gap-2">
                  <GitFork className="h-4 w-4" />
                  <span>{t("local_split_control_title")}</span>
                </div>
              }
              hint={t("local_split_control_hint")}
            >
              <ul className="flex flex-col divide-y">
                {splitRows.map((m) => (
                  <li
                    key={m.obshtinaCode}
                    className="flex items-center gap-2 py-2 text-sm"
                  >
                    <Link
                      to={`/local/${cycle}/${m.obshtinaCode}`}
                      className="w-28 shrink-0 truncate font-medium hover:underline"
                    >
                      {m.name}
                    </Link>
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span
                        aria-hidden
                        className="inline-block size-2 rounded-full ring-1 ring-border shrink-0"
                        style={{ backgroundColor: m.electedMayor!.color }}
                      />
                      <span className="truncate text-muted-foreground">
                        {m.electedMayor!.displayName}
                      </span>
                    </span>
                    <span className="shrink-0 opacity-50">→</span>
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span
                        aria-hidden
                        className="inline-block size-2 rounded-full ring-1 ring-border shrink-0"
                        style={{ backgroundColor: m.topCouncil!.color }}
                      />
                      <span className="truncate text-muted-foreground">
                        {m.topCouncil!.displayName}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </StatCard>
          ) : null}
        </div>
      </DashboardSection>

      {/* Estimated council vote flow vs the previous cycle, for this oblast. */}
      <DashboardSection id="local-flows" title={t("local_sec_flows")}>
        <LocalVoteFlowTile cycle={cycle} oblast={oblast} />
      </DashboardSection>

      {/* Município directory (the full A-Z list lives here). */}
      <DashboardSection
        id="local-overview"
        title={t("local_cycle_overview_municipalities_section")}
      >
        <div className="rounded-xl border bg-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wide text-muted-foreground border-b">
              <tr>
                <th className="py-2 px-3 text-left">
                  {t("local_cycle_overview_municipalities_section")}
                </th>
                <th className="py-2 px-3 text-left">
                  {t("local_election_stat_mayor")}
                </th>
                <th className="hidden py-2 px-3 text-left md:table-cell">
                  {t("local_national_top_council_party")}
                </th>
                <th className="py-2 px-3 text-right w-20">
                  {t("local_election_stat_council_seats")}
                </th>
              </tr>
            </thead>
            <tbody>
              {region.municipalities.map((m) => (
                <tr key={m.obshtinaCode} className="border-b last:border-b-0">
                  <td className="py-2 px-3">
                    <Link
                      to={`/local/${cycle}/${m.obshtinaCode}`}
                      className="font-medium hover:underline"
                    >
                      {m.name}
                    </Link>
                    {m.hadRound2 ? (
                      <span className="ml-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                        II
                      </span>
                    ) : null}
                  </td>
                  <td className="py-2 px-3">
                    {m.electedMayor ? (
                      <PartyChip
                        name={m.electedMayor.displayName}
                        color={m.electedMayor.color}
                      />
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="hidden py-2 px-3 md:table-cell">
                    {m.topCouncil ? (
                      <PartyChip
                        name={m.topCouncil.displayName}
                        color={m.topCouncil.color}
                      />
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums">
                    {formatThousands(m.councilSeats)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DashboardSection>
    </div>
  );
};
