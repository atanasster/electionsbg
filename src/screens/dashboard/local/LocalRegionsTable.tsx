// Oblast-level results table for a local-elections cycle (mayoral control +
// council seats + município count per oblast). Tile mode (limit set) renders
// the top-N regions with a "see details" link to the full table; full mode
// (no limit) renders every oblast. Shared by the country dashboard tile and
// the dedicated /local/:cycle/regions screen.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { MapPin } from "lucide-react";
import { useLocalRegionsSummary } from "@/data/local/useLocalRegionsSummary";
import { useRegions } from "@/data/regions/useRegions";
import { PartyChip } from "@/screens/components/local/LocalRankedBar";
import { formatThousands } from "@/data/utils";
import { Hint } from "@/ux/Hint";

export const LocalRegionsTable: FC<{ cycle: string; limit?: number }> = ({
  cycle,
  limit,
}) => {
  const { t, i18n } = useTranslation();
  const { data: summary } = useLocalRegionsSummary(cycle);
  const { findRegion } = useRegions();
  const allRows = useMemo(
    () =>
      summary
        ? [...summary.regions].sort(
            (a, b) => b.municipalityCount - a.municipalityCount,
          )
        : [],
    [summary],
  );
  if (allRows.length === 0) return null;
  const rows = limit != null ? allRows.slice(0, limit) : allRows;
  const showDetails = limit != null && allRows.length > limit;

  const regionName = (code: string): string => {
    const info = findRegion(code);
    if (!info) return code === "SOF" ? t("local_region_sofia_city") : code;
    return (
      (i18n.language === "bg"
        ? info.long_name || info.name
        : info.long_name_en || info.name_en) || code
    );
  };
  const regionPath = (code: string): string =>
    code === "SOF" ? `/local/${cycle}/SOF` : `/local/${cycle}/region/${code}`;

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      {limit != null ? (
        <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
          <Hint text={t("local_top_regions_hint")} underline={false}>
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <MapPin className="h-4 w-4" />
              <span>{t("local_top_regions")}</span>
            </div>
          </Hint>
          {showDetails ? (
            <Link
              to={`/local/${cycle}/regions`}
              className="text-[10px] normal-case text-primary hover:underline"
            >
              {t("dashboard_see_details")} →
            </Link>
          ) : null}
        </div>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase tracking-wide text-muted-foreground border-b">
            <tr>
              <th className="py-2 px-3 text-left">
                {t("local_region_th_region")}
              </th>
              <th className="py-2 px-3 text-left">
                {t("local_region_th_control")}
              </th>
              <th className="hidden py-2 px-3 text-right w-20 sm:table-cell">
                {t("local_election_stat_council_seats")}
              </th>
              <th className="py-2 px-3 text-right w-16">
                {t("local_region_th_municipalities")}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.oblast} className="border-b last:border-b-0">
                <td className="py-2 px-3">
                  <Link
                    to={regionPath(r.oblast)}
                    className="font-medium hover:underline"
                  >
                    {regionName(r.oblast)}
                  </Link>
                </td>
                <td className="py-2 px-3">
                  {r.topMayor ? (
                    <PartyChip
                      name={r.topMayor.displayName}
                      color={r.topMayor.color}
                      suffix={t("local_region_mayors_count", {
                        count: r.topMayor.count,
                      })}
                    />
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="hidden py-2 px-3 text-right tabular-nums sm:table-cell">
                  {formatThousands(r.totalCouncilSeats)}
                </td>
                <td className="py-2 px-3 text-right tabular-nums">
                  {r.municipalityCount}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
