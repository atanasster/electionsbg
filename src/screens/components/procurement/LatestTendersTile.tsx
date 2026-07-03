// "Just announced" — the most recent tender procedures in the current scope,
// for the procurement dashboard's pipeline section. Estimated (forecast)
// values, never spend — same caveat as the tenders browser this links into.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ClipboardList, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { useLatestTenders } from "@/data/procurement/useLatestTenders";
import { useProcurementHref } from "@/data/procurement/useProcurementScope";
import { formatEurCompact } from "@/lib/currency";
import { decodeEntities } from "@/lib/decodeEntities";

export const LatestTendersTile: FC = () => {
  const { t, i18n } = useTranslation();
  const buildHref = useProcurementHref();
  const { data: rows } = useLatestTenders(5);
  if (!rows || rows.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-indigo-600" />
          {t("procurement_latest_tenders_title") || "Latest announced tenders"}
          <span className="text-xs text-muted-foreground font-normal">
            {t("procurement_latest_tenders_note") || "estimated value"}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 pt-0">
        <ul className="flex flex-col">
          {rows.map((td) => (
            <li
              key={td.unp}
              className="flex items-center gap-2 py-1.5 border-b border-border/40 last:border-b-0 text-sm"
            >
              <span className="text-xs text-muted-foreground tabular-nums shrink-0 hidden sm:inline">
                {td.publicationDate}
              </span>
              <span className="min-w-0 flex-1">
                <Link
                  to={`/tenders/${td.unp}`}
                  className="block truncate hover:underline"
                  title={td.subject}
                >
                  {decodeEntities(td.subject || td.unp)}
                </Link>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {decodeEntities(td.buyerName)}
                </span>
              </span>
              <span className="tabular-nums text-xs font-medium shrink-0">
                {td.estimatedValueEur != null
                  ? formatEurCompact(td.estimatedValueEur, i18n.language)
                  : "—"}
              </span>
            </li>
          ))}
        </ul>
        <Link
          to={buildHref("/procurement/tenders")}
          className="mt-3 flex items-center justify-center gap-1.5 rounded-md border border-border bg-accent/30 px-3 py-2 text-xs font-medium text-foreground hover:bg-accent/60 transition-colors"
        >
          {t("procurement_latest_tenders_see_all") || "Browse all tenders"}
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </CardContent>
    </Card>
  );
};
