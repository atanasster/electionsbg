// Dashboard tile: top procurement awarders (the государственные buyers paying
// out the money) with a "Виж всички" link to the standalone awarders page.
// Mirrors TopContractorsTile in structure — same Card layout, just keyed
// on the awarder side of each contract.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Building2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { FollowStar } from "./FollowStar";
import type {
  ProcurementByNsTopAwarder,
  ProcurementByNsFile,
} from "@/data/dataTypes";
import { useProcurementByNs } from "@/data/procurement/useProcurementByNs";

const TOP_ROWS = 10;

const formatEur = new Intl.NumberFormat("bg-BG", { maximumFractionDigits: 0 });

const renderAwarders = (
  rows: ProcurementByNsTopAwarder[],
  t: (k: string) => string,
) => (
  <table className="w-full text-sm">
    <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
      <tr>
        <th className="text-left px-3 py-2 w-10">#</th>
        <th className="text-left px-3 py-2">
          {t("procurement_col_awarder") || "Awarder"}
        </th>
        <th className="text-right px-3 py-2">
          {t("procurement_index_col_total") || "Total"}
        </th>
        <th className="text-right px-3 py-2 hidden md:table-cell">
          {t("procurement_index_col_contracts") || "Contracts"}
        </th>
        <th className="px-1 py-2 w-8" aria-hidden />
      </tr>
    </thead>
    <tbody className="divide-y divide-border">
      {rows.map((e, idx) => (
        <tr key={e.eik}>
          <td className="px-3 py-2 text-muted-foreground tabular-nums">
            {idx + 1}
          </td>
          <td className="px-3 py-2">
            <Link
              to={`/awarder/${e.eik}`}
              className="font-medium hover:underline"
            >
              {e.name}
            </Link>
          </td>
          <td className="px-3 py-2 text-right tabular-nums">
            €{formatEur.format(Math.round(e.totalEur))}
          </td>
          <td className="px-3 py-2 text-right tabular-nums hidden md:table-cell">
            {e.contractCount.toLocaleString("bg-BG")}
          </td>
          <td className="px-1 py-2 text-center">
            <FollowStar kind="awarder" id={e.eik} label={e.name} />
          </td>
        </tr>
      ))}
    </tbody>
  </table>
);

export const TopAwardersTile: FC<{
  // Pre-loaded data path: pass `data` to avoid the hook re-fetching when the
  // parent already has the per-NS file in hand.
  data?: ProcurementByNsFile | null;
}> = ({ data: dataProp }) => {
  const { t } = useTranslation();
  const q = useProcurementByNs(dataProp === undefined);
  const data = dataProp !== undefined ? dataProp : q.data;
  const isLoading = dataProp !== undefined ? false : q.isLoading;

  if (isLoading) {
    return (
      <Card className="my-4" aria-hidden>
        <CardContent>
          <div className="min-h-[440px]" />
        </CardContent>
      </Card>
    );
  }
  if (!data || data.topAwarders.length === 0) return null;
  const rows = data.topAwarders.slice(0, TOP_ROWS);

  return (
    <Card className="my-4">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <Building2 className="h-4 w-4" />
          {t("procurement_top_awarders") || "Top awarders"}
          <span className="text-xs text-muted-foreground font-normal ml-1">
            {t("procurement_top_awarders_subtitle") ||
              "State buyers ranked by total contract value (EUR-converted)."}
          </span>
          <Link
            to="/procurement/awarders"
            className="ml-auto text-[10px] normal-case text-primary hover:underline"
          >
            {t("procurement_tile_see_all") || "See all"} →
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4">
        <div className="rounded-md border bg-card overflow-hidden">
          {renderAwarders(rows, t)}
        </div>
      </CardContent>
    </Card>
  );
};
