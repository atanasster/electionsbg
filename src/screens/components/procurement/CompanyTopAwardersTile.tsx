// Top awarders teaser for the company dashboard. Shows the top 10 awarders
// (from the contractor rollup's pre-computed byAwarder list) with a link
// to /company/:eik/awarders for the full list.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowRight, Building2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import type { ProcurementContractorRollup } from "@/data/dataTypes";
import { formatEurWithOther } from "@/lib/currency";

const TOP_ROWS = 10;

export const CompanyTopAwardersTile: FC<{
  eik: string;
  rollup: ProcurementContractorRollup;
  /** Link builder for an awarder row (DB page routes to the DB awarder view). */
  awarderHref?: (eik: string) => string;
  /** Override the "see all" target (defaults to the JSON awarders page). */
  seeAllHref?: string;
  /** Render an inline proportion bar in the share column (DB page). */
  showBars?: boolean;
}> = ({ eik, rollup, awarderHref, seeAllHref, showBars }) => {
  const { t, i18n } = useTranslation();
  const hrefAwarder = awarderHref ?? ((e: string) => `/awarder/${e}`);
  const rows = rollup.byAwarder.slice(0, TOP_ROWS);
  if (rows.length === 0) return null;
  // Bars scale to the top awarder (#1 = full width) so proportions read even
  // when the leader is only a small slice of the whole.
  const maxEur = Math.max(...rows.map((a) => a.totalEur), 1);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <Building2 className="h-4 w-4" />
          {t("company_top_awarders") || "Top awarders"}
          <span className="text-xs text-muted-foreground font-normal ml-1">
            {t("company_top_awarders_subtitle") ||
              "State buyers that paid this company."}
          </span>
          {(rollup.awarderCount ?? rollup.byAwarder.length) > TOP_ROWS ? (
            <Link
              to={seeAllHref ?? `/company/${eik}/awarders`}
              className="ml-auto inline-flex items-center gap-1 text-xs text-primary hover:underline font-normal"
            >
              {t("procurement_tile_see_all") || "See all"}
              <ArrowRight className="h-3 w-3" />
            </Link>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4">
        <div className="rounded-md border bg-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2 w-10">#</th>
                <th className="text-left px-3 py-2">
                  {t("company_col_awarder") || "Awarder"}
                </th>
                <th className="text-right px-3 py-2">
                  {t("company_col_total") || "Total"}
                </th>
                <th className="text-right px-3 py-2 hidden md:table-cell">
                  {t("company_col_contracts") || "Contracts"}
                </th>
                <th className="text-right px-3 py-2 hidden sm:table-cell">
                  {i18n.language === "bg" ? "Дял" : "Share"}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((a, idx) => (
                <tr key={a.eik}>
                  <td className="px-3 py-2 text-muted-foreground tabular-nums">
                    {idx + 1}
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      to={hrefAwarder(a.eik)}
                      className="font-medium hover:underline"
                    >
                      {a.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatEurWithOther(
                      a.totalEur,
                      a.totalOther,
                      i18n.language,
                    ) || "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums hidden md:table-cell">
                    {a.contractCount.toLocaleString("bg-BG")}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums hidden sm:table-cell text-muted-foreground">
                    {showBars ? (
                      <div className="flex items-center justify-end gap-2">
                        <span className="h-1.5 w-16 md:w-24 overflow-hidden rounded bg-muted">
                          <span
                            className="block h-full rounded bg-primary/70"
                            style={{
                              width: `${Math.max(3, (a.totalEur / maxEur) * 100)}%`,
                            }}
                          />
                        </span>
                        <span className="w-9 text-right">
                          {rollup.totalEur > 0
                            ? Math.round((a.totalEur / rollup.totalEur) * 100) +
                              "%"
                            : "—"}
                        </span>
                      </div>
                    ) : rollup.totalEur > 0 ? (
                      ((a.totalEur / rollup.totalEur) * 100).toLocaleString(
                        i18n.language,
                        { maximumFractionDigits: 1 },
                      ) + "%"
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
};
