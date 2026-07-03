// "Just signed" — the most recent contracts ≥ €100k in the current scope, for
// the procurement dashboard. Each row deep-links into the contract page; the
// footer opens the full server-side contracts browser with the same scope.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Receipt, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { useLatestContracts } from "@/data/procurement/useLatestContracts";
import { useProcurementHref } from "@/data/procurement/useProcurementScope";
import { formatEurCompact } from "@/lib/currency";
import { decodeEntities } from "@/lib/decodeEntities";

export const LatestContractsTile: FC = () => {
  const { t, i18n } = useTranslation();
  const buildHref = useProcurementHref();
  const { data: rows } = useLatestContracts(6);
  if (!rows || rows.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Receipt className="h-4 w-4 text-muted-foreground" />
          {t("procurement_latest_title") || "Just signed (over €100k)"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 pt-0">
        <ul className="flex flex-col">
          {rows.map((c) => (
            <li
              key={c.key}
              className="flex items-center gap-2 py-1.5 border-b border-border/40 last:border-b-0 text-sm"
            >
              <span className="text-xs text-muted-foreground tabular-nums shrink-0 hidden sm:inline">
                {c.date}
              </span>
              <span className="min-w-0 flex-1">
                <Link
                  to={`/procurement/contract/${c.key}`}
                  className="block truncate hover:underline"
                  title={c.title ?? undefined}
                >
                  {decodeEntities(c.title || c.contractorName || c.key)}
                </Link>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {decodeEntities(c.awarderName)} →{" "}
                  {decodeEntities(c.contractorName)}
                </span>
              </span>
              <span className="tabular-nums text-xs font-medium shrink-0">
                {c.amountEur != null
                  ? formatEurCompact(c.amountEur, i18n.language)
                  : "—"}
              </span>
            </li>
          ))}
        </ul>
        <Link
          to={buildHref("/procurement/contracts")}
          className="mt-3 flex items-center justify-center gap-1.5 rounded-md border border-border bg-accent/30 px-3 py-2 text-xs font-medium text-foreground hover:bg-accent/60 transition-colors"
        >
          {t("procurement_latest_see_all") || "Browse all contracts"}
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </CardContent>
    </Card>
  );
};
