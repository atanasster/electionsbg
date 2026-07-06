// ОПУ regional-maintenance competition — one row per oblast road directorate
// (Областно пътно управление), coloured by its single-bidder share. Regional
// upkeep is where competition quietly collapses: a captured ОПУ awards most of
// its lots to one contractor with a single bid. Sized by € so the reader sees
// both how much a region spends and how contested it is. Data straight from
// model.regions (regionOf → RegionAgg); no engine change.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { MapPinned } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import type { RegionAgg } from "@/lib/roadAttributes";

// Green (competitive) → amber → red (captured), on the same red-line intuition
// as the EU benchmarks: ≤30% amber start, >60% deep red.
const shareColor = (s: number): string => {
  if (s >= 0.6) return "bg-red-500/70";
  if (s >= 0.3) return "bg-amber-500/70";
  return "bg-emerald-500/70";
};

export const RoadRegionCompetitionTile: FC<{ regions: RegionAgg[] }> = ({
  regions,
}) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;

  // Only regions with a measurable bid signal + enough spend to matter.
  const rows = useMemo(
    () =>
      regions
        .filter((r) => r.singleBidShare != null && r.contractCount >= 3)
        .sort((a, b) => (b.singleBidShare ?? 0) - (a.singleBidShare ?? 0))
        .slice(0, 12),
    [regions],
  );
  if (rows.length < 3) return null;

  const maxEur = Math.max(...rows.map((r) => r.totalEur), 1);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <MapPinned className="h-4 w-4" />
          {lang === "bg"
            ? "Конкуренция по областни пътни управления"
            : "Competition by regional road directorate"}
          <span className="text-xs font-normal text-muted-foreground">
            {lang === "bg" ? "една оферта, ОПУ" : "single-bid, ОПУ"}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-1.5">
        {rows.map((r) => {
          const s = r.singleBidShare ?? 0;
          return (
            <div key={r.region} className="flex items-center gap-2 text-xs">
              <span className="w-24 sm:w-32 shrink-0 truncate" title={r.region}>
                {r.region}
              </span>
              <span className="flex-1 min-w-0 h-2.5 rounded bg-muted overflow-hidden">
                <span
                  className={`block h-full ${shareColor(s)}`}
                  style={{
                    width: `${Math.max(2, (r.totalEur / maxEur) * 100)}%`,
                  }}
                />
              </span>
              <span
                className={`w-12 shrink-0 text-right tabular-nums font-medium ${
                  s >= 0.6
                    ? "text-red-700 dark:text-red-400"
                    : s >= 0.3
                      ? "text-amber-700 dark:text-amber-400"
                      : "text-emerald-700 dark:text-emerald-400"
                }`}
              >
                {(s * 100).toLocaleString(lang, { maximumFractionDigits: 0 })}%
              </span>
              <span className="w-14 shrink-0 text-right tabular-nums text-muted-foreground">
                {formatEurCompact(r.totalEur, lang)}
              </span>
            </div>
          );
        })}
        <p className="pt-1 text-[11px] text-muted-foreground/80">
          {lang === "bg"
            ? "Дял на договорите с една оферта по ОПУ. Дължината на лентата е вложените средства. Червено = слаба конкуренция."
            : "Single-bid share per regional directorate. Bar length is € spent. Red = weak competition."}
        </p>
      </CardContent>
    </Card>
  );
};
