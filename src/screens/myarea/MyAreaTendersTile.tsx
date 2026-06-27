// My-Area tenders tile (Band E — Money). The procurement PIPELINE for this place:
// recently ANNOUNCED procedures by its municipal-tier buyers, before any contract
// is signed. Complements MyAreaProcurementTile (signed-contract spend) and the
// chronological alerts feed. Estimated value is a forecast — labelled, and kept
// out of any spend figure. Reuses the per-município summary; no new fetch shape.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ClipboardList, ArrowRight } from "lucide-react";
import { Card } from "@/ux/Card";
import { useMyAreaPlaceTenders } from "@/data/myarea/useMyAreaPlaceTenders";
import { formatEurCompact } from "@/lib/currency";

const numFmt = new Intl.NumberFormat("bg-BG");

export const MyAreaTendersTile: FC<{ obshtina: string }> = ({ obshtina }) => {
  const { t, i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const { data, isLoading } = useMyAreaPlaceTenders(obshtina);

  if (isLoading) return null;
  if (!data || data.count === 0) return null;

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <ClipboardList className="size-4 text-indigo-600" />
        <h2 className="text-sm font-semibold flex-1">
          {t("my_area_tenders_title") || "Recent tenders here"}
        </h2>
        <Link
          to="/procurement/tenders"
          className="text-xs text-primary hover:underline inline-flex items-center gap-1"
        >
          {t("my_area_procurement_all") || "All"}
          <ArrowRight className="size-3" />
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-3">
        <Kpi
          label={t("my_area_tenders_count") || "Procedures"}
          value={numFmt.format(data.count)}
        />
        <Kpi
          label={t("my_area_tenders_estimated") || "Estimated (forecast)"}
          value={formatEurCompact(data.totalEstimatedEur, i18n.language)}
        />
      </div>

      <ul className="flex flex-col">
        {data.top.slice(0, 4).map((x) => (
          <li key={x.unp} className="border-b last:border-b-0">
            <Link
              to={`/tenders/${x.unp}`}
              className="group flex items-center gap-2 py-1.5 hover:bg-accent/30 rounded-sm -mx-1 px-1"
            >
              <span className="min-w-0 flex-1 text-xs truncate">
                {x.subject}
                {x.isCancelled ? (
                  <span className="text-amber-600">
                    {" "}
                    · {bg ? "прекратена" : "cancelled"}
                  </span>
                ) : null}
              </span>
              <span className="text-xs tabular-nums font-medium shrink-0">
                {x.estimatedValueEur != null
                  ? formatEurCompact(x.estimatedValueEur, i18n.language)
                  : "—"}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <p className="text-[10px] text-muted-foreground mt-3 italic">
        {t("my_area_tenders_caveat") ||
          "Estimated (announced) values — forecasts, not money spent. Local-tier buyers only."}
      </p>
    </Card>
  );
};

const Kpi: FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="rounded-md border bg-muted/20 px-2 py-1.5">
    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
      {label}
    </div>
    <div className="text-sm font-semibold tabular-nums truncate">{value}</div>
  </div>
);
