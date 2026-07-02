// Sector-benchmarking tile for the DB company page. Ranks the contractor within
// each CPV DIVISION it operates in against every other contractor in that
// division: rank, percentile, market share, and how it compares to the median
// contractor. The "is this supplier disproportionately large in its market?"
// lens. Fed by company_sectors() (PG matview sector_contractor_stats).
// See 018_sector_stats.sql.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { BarChart3 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import { cpvDivisionName } from "@/lib/cpvSectors";

export interface SectorRank {
  division: string;
  totalEur: number;
  contractCount: number;
  rank: number;
  divContractors: number;
  divTotalEur: number;
  divMedianEur: number;
}

// Only sectors where the company has real presence (skip €0 / trivial tails).
const MIN_EUR = 10_000;
const SHOWN = 4;

// Badge tone by how high the company ranks in the division.
const rankTone = (rank: number, of: number): string => {
  const pct = rank / of;
  return rank <= 3 || pct <= 0.01
    ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
    : pct <= 0.1
      ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"
      : "bg-muted text-muted-foreground";
};

export const CompanySectorRankTile: FC<{ data: SectorRank[] }> = ({ data }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const nf = new Intl.NumberFormat(lang === "bg" ? "bg-BG" : "en-GB");
  const fmtPct = (frac: number): string =>
    (frac * 100).toLocaleString(lang === "bg" ? "bg-BG" : "en-GB", {
      maximumFractionDigits: frac >= 0.1 ? 0 : 1,
    }) + "%";

  const rows = data.filter((s) => s.totalEur >= MIN_EUR).slice(0, SHOWN);
  if (rows.length === 0) return null;

  return (
    <Card className="my-4">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <BarChart3 className="h-4 w-4" />
          {t("company_sector_title") || "Позиция в сектора"}
          <span className="text-xs text-muted-foreground font-normal ml-1">
            {t("company_sector_subtitle") ||
              "Класиране сред изпълнителите във всеки CPV раздел"}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        {rows.map((s) => {
          const marketShare =
            s.divTotalEur > 0 ? s.totalEur / s.divTotalEur : 0;
          const vsMedian =
            s.divMedianEur > 0 ? s.totalEur / s.divMedianEur : null;
          return (
            <div key={s.division} className="space-y-1">
              <div className="flex items-baseline justify-between gap-2">
                <span
                  className="text-sm font-medium truncate max-w-[62%]"
                  title={cpvDivisionName(s.division, lang)}
                >
                  {cpvDivisionName(s.division, lang)}
                </span>
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold tabular-nums ${rankTone(
                    s.rank,
                    s.divContractors,
                  )}`}
                >
                  №{nf.format(s.rank)} {t("company_sector_of") || "от"}{" "}
                  {nf.format(s.divContractors)}
                </span>
              </div>
              <div className="text-xs text-muted-foreground tabular-nums">
                {formatEurCompact(s.totalEur, lang)} · {fmtPct(marketShare)}{" "}
                {t("company_sector_of_market") || "от раздела"}
                {vsMedian && vsMedian >= 2
                  ? ` · ${nf.format(Math.round(vsMedian))}× ${
                      t("company_sector_median") || "над медианата"
                    }`
                  : ` · ${t("company_sector_median_label") || "медиана"} ${formatEurCompact(
                      s.divMedianEur,
                      lang,
                    )}`}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
};
