// Region (oblast) local-elections dashboard — one fetch (region/<oblast>.json).
// Stacked tiles, no tabs (per UX standard): stat header, municipalities
// choropleth, mayors-won + council-seats bars, and the município directory.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useLocalRegion } from "@/data/local/useLocalRegion";
import {
  PartyChip,
  RankedBar,
} from "@/screens/components/local/LocalRankedBar";
import { formatThousands } from "@/data/utils";
import { StatCard } from "../StatCard";
import { LocalRegionMapTile } from "./LocalRegionMapTile";

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
    <div className="space-y-6">
      {/* Stat header */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
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
        <StatCard label={t("local_national_municipalities")}>
          <span className="tabular-nums text-base font-semibold">
            {region.municipalityCount}
          </span>
        </StatCard>
        <StatCard label={t("local_national_runoffs")}>
          <span className="tabular-nums text-base font-semibold">
            {region.runoffCount}
          </span>
        </StatCard>
      </div>

      {/* Municipalities choropleth */}
      <LocalRegionMapTile cycle={cycle} oblast={oblast} />

      {/* Mayors-won + council-seats rankings */}
      <div className="grid gap-3 lg:grid-cols-2">
        {region.mayorsWon.length > 0 ? (
          <section>
            <h2 className="text-lg font-semibold mb-3">
              {t("local_region_mayors_section")}
            </h2>
            <ul className="rounded-xl border bg-card p-3">
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
          </section>
        ) : null}
        {region.councilSeats.length > 0 ? (
          <section>
            <h2 className="text-lg font-semibold mb-3">
              {t("local_region_council_section")}
            </h2>
            <ul className="rounded-xl border bg-card p-3">
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
          </section>
        ) : null}
      </div>

      {/* Município directory */}
      <section>
        <h2 className="text-lg font-semibold mb-3">
          {t("local_cycle_overview_municipalities_section")}
        </h2>
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
                  <td className="py-2 px-3 text-right tabular-nums">
                    {formatThousands(m.councilSeats)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
