// /funds — compact teaser for /funds/rrf. Displays the ПВУ paid-vs-contracted
// figure on the landing page next to the rest of the political-economy stack.
// Reuses the per-programme summary that the programme drill-down already
// fetches, so the tile loads only a ~10 KB file.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Activity } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { useFundsProgramSummary } from "@/data/funds/useFundsProgramSummary";
import { formatEur } from "@/lib/currency";

const RRP_CODE = "2021BG-RRP";

export const RrfTeaserTile: FC = () => {
  const { t } = useTranslation();
  const { data, isLoading } = useFundsProgramSummary(RRP_CODE);

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            {t("rrf_teaser_title") || "RRP — Recovery Plan"}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 md:p-4">
          <div className="h-24 animate-pulse rounded bg-muted" />
        </CardContent>
      </Card>
    );
  }
  if (!data) return null;

  const contracted = data.rollup.totalEur;
  const paid = data.rollup.paidEur;
  const absorption = contracted > 0 ? Math.round((paid / contracted) * 100) : 0;
  const tone =
    absorption >= 50
      ? "bg-emerald-500"
      : absorption >= 30
        ? "bg-amber-500"
        : "bg-rose-500";

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4 text-rose-600" />
          {t("rrf_teaser_title") || "RRP — Recovery Plan"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-2">
        <p className="text-xs text-muted-foreground">
          {t("rrf_teaser_intro") ||
            "Bulgaria's NextGenerationEU envelope. The implementation deadline is August 2026."}
        </p>
        <div className="flex items-baseline justify-between gap-2 text-sm">
          <span className="font-medium">
            {formatEur(paid)} {t("funds_index_paid") || "paid"} /{" "}
            {formatEur(contracted)}{" "}
            {t("funds_index_contracted") || "contracted"}
          </span>
          <span className="tabular-nums">
            <span className="text-lg font-bold">{absorption}%</span>{" "}
            <span className="text-xs text-muted-foreground">
              {t("absorption_absorbed") || "absorbed"}
            </span>
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full rounded-full ${tone}`}
            style={{ width: `${Math.min(100, absorption)}%` }}
          />
        </div>
        <Link
          to="/funds/rrf"
          className="inline-block text-sm font-medium text-primary hover:underline"
        >
          {t("rrf_teaser_open") || "Open the RRF dashboard →"}
        </Link>
      </CardContent>
    </Card>
  );
};
