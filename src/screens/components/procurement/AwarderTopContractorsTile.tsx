// Top contractors-paid teaser for the awarder dashboard. Mirror of
// CompanyTopAwardersTile but on the awarder side — pulls from the awarder
// rollup's byContractor list.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowRight, Receipt } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import type { ProcurementAwarderRollup } from "@/data/dataTypes";
import { formatEurWithOther } from "@/lib/currency";

const TOP_ROWS = 10;

const EMPTY_SET: Set<string> = new Set();

export const AwarderTopContractorsTile: FC<{
  eik: string;
  rollup: ProcurementAwarderRollup;
  // EIK → mpIds map so MP-tied rows can be highlighted at-a-glance even
  // before the user scrolls back up to the dedicated MP-tied section.
  mpTiedEiks?: Set<string>;
  /** Link builder for a contractor row (DB page routes to the DB company view). */
  contractorHref?: (eik: string) => string;
  /** Override the "see all" target (defaults to the JSON contractors page). */
  seeAllHref?: string;
}> = ({ eik, rollup, mpTiedEiks = EMPTY_SET, contractorHref, seeAllHref }) => {
  const { t, i18n } = useTranslation();
  const hrefContractor = contractorHref ?? ((e: string) => `/company/${e}`);
  const rows = rollup.byContractor.slice(0, TOP_ROWS);
  if (rows.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <Receipt className="h-4 w-4" />
          {t("awarder_top_contractors") || "Top contractors paid"}
          <span className="text-xs text-muted-foreground font-normal ml-1">
            {t("awarder_top_contractors_subtitle") ||
              "Companies ranked by total amount received from this awarder."}
          </span>
          {(rollup.contractorCount ?? rollup.byContractor.length) > TOP_ROWS ? (
            <Link
              to={seeAllHref ?? `/awarder/${eik}/contractors`}
              className="ml-auto inline-flex items-center gap-1 text-xs text-primary hover:underline font-normal"
            >
              {t("procurement_tile_see_all") || "See all"}
              <ArrowRight className="h-3 w-3" />
            </Link>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4">
        <div className="rounded-md border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2 w-10">#</th>
                <th className="text-left px-3 py-2">
                  {t("procurement_col_contractor") || "Contractor"}
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
              {rows.map((c, idx) => (
                <tr
                  key={c.eik}
                  className={
                    mpTiedEiks.has(c.eik)
                      ? "bg-amber-50 dark:bg-amber-950/20"
                      : undefined
                  }
                >
                  <td className="px-3 py-2 text-muted-foreground tabular-nums">
                    {idx + 1}
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      to={hrefContractor(c.eik)}
                      className="font-medium hover:underline"
                    >
                      {c.name}
                    </Link>
                    {mpTiedEiks.has(c.eik) ? (
                      <span className="ml-2 inline-block rounded bg-amber-200/60 dark:bg-amber-800/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
                        {t("procurement_index_mp_tag") || "MP-tied"}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatEurWithOther(
                      c.totalEur,
                      c.totalOther,
                      i18n.language,
                    ) || "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums hidden md:table-cell">
                    {c.contractCount.toLocaleString("bg-BG")}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums hidden sm:table-cell text-muted-foreground">
                    {rollup.totalEur > 0
                      ? ((c.totalEur / rollup.totalEur) * 100).toLocaleString(
                          i18n.language,
                          { maximumFractionDigits: 1 },
                        ) + "%"
                      : "—"}
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
