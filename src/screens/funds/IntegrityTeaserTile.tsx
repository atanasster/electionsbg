// /funds — Compact teaser for /funds/integrity. Surfaces just the headline
// counts (high-HHI programmes, debarred overlap) plus the top-3 most-
// concentrated programmes, with a "see all" link. Loads only the slim
// integrity.json (~50 KB).

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ShieldAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { useFundsIntegrityIndex } from "@/data/funds/useFundsIntegrity";
import { formatEur } from "@/lib/currency";

const numFmt = new Intl.NumberFormat("bg-BG");

export const IntegrityTeaserTile: FC = () => {
  const { t } = useTranslation();
  const { data, isLoading } = useFundsIntegrityIndex();

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            {t("integrity_teaser_title") || "Red flags"}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 md:p-4">
          <div className="h-24 animate-pulse rounded bg-muted" />
        </CardContent>
      </Card>
    );
  }
  if (!data) return null;

  const t1 = data.totals;
  const top3 = data.topByConcentration.slice(0, 3);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldAlert className="h-4 w-4 text-rose-600" />
          {t("integrity_teaser_title") || "Red flags"}
          <span className="text-xs font-normal text-muted-foreground">
            {numFmt.format(t1.highConcentrationCount)}{" "}
            {t("integrity_teaser_high") || "high-concentration"} ·{" "}
            {numFmt.format(t1.debarredOverlapCount)}{" "}
            {t("integrity_teaser_debarred") || "debarred"}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-2">
        <p className="text-xs text-muted-foreground">
          {t("integrity_teaser_intro") ||
            "Programmes where one or two beneficiaries dominate, beneficiaries who win across multiple programmes, and AOP debarred suppliers found in ИСУН."}
        </p>
        <ul className="flex flex-col divide-y divide-border">
          {top3.map((p) => (
            <li
              key={p.programCode}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 first:pt-0 last:pb-0"
            >
              <div className="min-w-0 flex-1">
                <Link
                  to={`/funds/programme/${encodeURIComponent(p.programCode)}`}
                  className="font-medium hover:underline"
                >
                  {p.programName}
                </Link>
                <div className="text-[11px] text-muted-foreground">
                  {p.fundType} · {p.period} ·{" "}
                  {t("integrity_top1") || "Top winner"} {p.top1Name} (
                  {(p.top1Share * 100).toFixed(0)}%)
                </div>
              </div>
              <span className="ml-auto rounded bg-rose-100 px-2 py-0.5 text-xs font-semibold tabular-nums text-rose-900 dark:bg-rose-900/40 dark:text-rose-200">
                HHI {Math.round(p.hhi).toLocaleString("en-US")}
              </span>
              <span className="text-sm font-medium tabular-nums">
                {formatEur(p.totalEur)}
              </span>
            </li>
          ))}
        </ul>
        <Link
          to="/funds/integrity"
          className="inline-block text-sm font-medium text-primary hover:underline"
        >
          {t("integrity_teaser_view_all") || "Open the red-flags dashboard →"}
        </Link>
      </CardContent>
    </Card>
  );
};
