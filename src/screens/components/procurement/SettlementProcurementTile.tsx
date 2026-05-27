// Procurement tile for an existing settlement detail page. Renders only
// when the EKATTE has local-tier procurement on file — the hook returns
// null for settlements that don't appear in by_settlement/, in which
// case this component returns null and the parent shows nothing.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Building2, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { useSettlementProcurement } from "@/data/procurement/useSettlementProcurement";

const eurFmt = new Intl.NumberFormat("bg-BG", { maximumFractionDigits: 0 });
const countFmt = new Intl.NumberFormat("bg-BG");

export const SettlementProcurementTile: FC<{ ekatte: string }> = ({
  ekatte,
}) => {
  const { t } = useTranslation();
  const q = useSettlementProcurement(ekatte);
  if (q.isLoading || !q.data || q.data.awarders.length === 0) return null;
  const data = q.data;

  return (
    <Card className="my-4">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2">
          <Building2 className="h-5 w-5" />
          {t("settlement_procurement_tile_title") || "Local procurement"}
        </CardTitle>
        <Link
          to={`/procurement/settlement/${ekatte}`}
          className="text-xs text-muted-foreground hover:underline inline-flex items-center gap-1"
        >
          {t("view_details") || "Details"}
          <ArrowRight className="h-3 w-3" />
        </Link>
      </CardHeader>
      <CardContent>
        <div className="mb-3 grid grid-cols-3 gap-3 text-sm">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              {t("procurement_settlement_kpi_local_eur") || "Total"}
            </div>
            <div className="text-lg font-semibold tabular-nums">
              €{eurFmt.format(Math.round(data.totalEur))}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              {t("procurement_settlement_kpi_contracts") || "Contracts"}
            </div>
            <div className="text-lg font-semibold tabular-nums">
              {countFmt.format(data.contractCount)}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              {t("procurement_settlement_kpi_buyers") || "Buyers"}
            </div>
            <div className="text-lg font-semibold tabular-nums">
              {countFmt.format(data.awarders.length)}
            </div>
          </div>
        </div>
        <div className="overflow-hidden rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-1.5">
                  {t("procurement_settlement_col_buyer") || "Buyer"}
                </th>
                <th className="text-right px-3 py-1.5 tabular-nums">
                  {t("procurement_settlement_col_eur") || "EUR"}
                </th>
                <th className="text-right px-3 py-1.5 tabular-nums hidden sm:table-cell">
                  {t("procurement_settlement_col_contracts") || "Contracts"}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.awarders.slice(0, 5).map((a) => (
                <tr key={a.eik}>
                  <td className="px-3 py-1.5">
                    <Link to={`/awarder/${a.eik}`} className="hover:underline">
                      {a.name}
                    </Link>
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    €{eurFmt.format(Math.round(a.totalEur))}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums hidden sm:table-cell">
                    {countFmt.format(a.contractCount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data.awarders.length > 5 && (
          <div className="mt-2 text-xs text-muted-foreground">
            {t("procurement_settlement_more_buyers") ||
              "More buyers on the detail page"}
            {" — "}
            <Link
              to={`/procurement/settlement/${ekatte}`}
              className="underline"
            >
              {t("view_all") || "view all"}
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
