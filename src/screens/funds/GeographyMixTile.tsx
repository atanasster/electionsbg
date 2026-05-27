// Where the contracts land — single-settlement vs single/multi-муни vs
// NUTS-region vs national/horizontal vs unresolved. The histogram answers
// "how much of EU-funds spending can we pin to a specific place?" which is
// the precondition for the per-place tile being useful — if 30 % of
// contracts were national/horizontal we'd want to caveat the place totals.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { MapPin } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import type { FundsProjectsIndexFile } from "@/data/funds/types";

const numFmt = new Intl.NumberFormat("bg-BG");

// One row per location-kind bucket. Order matches the spatial-precision
// hierarchy: settlement (most precise) → national (least precise).
const KINDS: Array<{
  key: keyof FundsProjectsIndexFile["totals"]["byLocationKind"];
  i18nKey: string;
  barClass: string;
}> = [
  {
    key: "settlement",
    i18nKey: "funds_geo_tile_settlement",
    barClass: "bg-emerald-400",
  },
  { key: "muni", i18nKey: "funds_geo_tile_muni", barClass: "bg-sky-400" },
  {
    key: "region",
    i18nKey: "funds_geo_tile_region",
    barClass: "bg-amber-400",
  },
  {
    key: "national",
    i18nKey: "funds_geo_tile_national",
    barClass: "bg-violet-400",
  },
  {
    key: "unresolved",
    i18nKey: "funds_geo_tile_unresolved",
    barClass: "bg-rose-400",
  },
];

export const GeographyMixTile: FC<{ index: FundsProjectsIndexFile }> = ({
  index,
}) => {
  const { t } = useTranslation();
  const buckets = index.totals.byLocationKind;
  const total = index.totals.contractCount;
  const placeable = buckets.settlement + buckets.muni;
  const placeablePct = total > 0 ? (placeable / total) * 100 : 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <MapPin className="h-4 w-4 text-emerald-600" aria-hidden />
          <span>{t("funds_geo_tile_title")}</span>
          <span className="text-xs font-normal text-muted-foreground">
            {t("funds_geo_tile_subtitle", {
              pct: placeablePct.toFixed(0),
            })}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        {/* Compact stacked-bar view, showing each kind's share of the total */}
        <div className="flex h-3 overflow-hidden rounded-full bg-muted">
          {KINDS.map(({ key, barClass }) => {
            const pct = total > 0 ? (buckets[key] / total) * 100 : 0;
            if (pct < 0.1) return null;
            return (
              <div
                key={key}
                className={barClass}
                style={{ width: `${pct}%` }}
                title={`${t(KINDS.find((k) => k.key === key)!.i18nKey)}: ${numFmt.format(buckets[key])}`}
              />
            );
          })}
        </div>
        {/* Per-kind legend */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
          {KINDS.map(({ key, i18nKey, barClass }) => {
            const v = buckets[key];
            const pct = total > 0 ? (v / total) * 100 : 0;
            return (
              <div key={key} className="flex items-baseline gap-2 tabular-nums">
                <span
                  className={`h-2.5 w-2.5 rounded-sm shrink-0 ${barClass}`}
                  aria-hidden
                />
                <span className="flex-1 min-w-0 truncate">{t(i18nKey)}</span>
                <span className="text-xs text-muted-foreground">
                  {numFmt.format(v)}
                </span>
                <span className="w-12 text-right font-medium">
                  {pct.toFixed(1)}%
                </span>
              </div>
            );
          })}
        </div>
        <p className="text-[11px] text-muted-foreground">
          {t("funds_geo_tile_caveat")}
        </p>
      </CardContent>
    </Card>
  );
};
