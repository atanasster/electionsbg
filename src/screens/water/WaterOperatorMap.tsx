// The /water signature visual: one marker per ВиК operator's HQ city, coloured by
// its single-bidder-contract share — the headline competition-risk indicator for the
// awarder pack. Where a city holds several operators (e.g. София's holding parent +
// ВиК София + Напоителни) the badge sums their contract counts and the busiest (most
// single-bid) operator colours the marker; the popup pages through them. Each marker
// links to that operator's /awarder/:eik page. Scope-aware via the shared ?pscope
// (the metric is windowed server-side in water_operator_map).
//
// The map itself is the shared SectorPointMap (reused across sector dashboards); this
// screen owns the colour banding, legend and caption around it. Mirrors
// src/screens/judiciary/CourtLoadMap.tsx.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Map as MapIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import {
  SectorPointMap,
  type SectorMapPoint,
} from "@/screens/components/maps/SectorPointMap";
import type { WaterOperatorPoint } from "@/data/water/useWaterOperatorMap";

// Single-bidder share bands. Higher share = weaker competition = redder. A neutral
// grey is used where no contract carries a tenderer count (share unknown).
const UNKNOWN_COLOR = "#94a3b8"; // slate-400
const BANDS: { max: number; color: string; label: string }[] = [
  { max: 0.2, color: "#15803d", label: "≤ 20%" }, // green-700
  { max: 0.4, color: "#65a30d", label: "20–40%" }, // lime-600
  { max: 0.6, color: "#d97706", label: "40–60%" }, // amber-600
  { max: 0.8, color: "#ea580c", label: "60–80%" }, // orange-600
  { max: Infinity, color: "#b91c1c", label: "> 80%" }, // red-700
];
const bandColor = (share: number | null) =>
  share == null
    ? UNKNOWN_COLOR
    : (BANDS.find((b) => share <= b.max) ?? BANDS[BANDS.length - 1]).color;

export const WaterOperatorMap: FC<{ operators: WaterOperatorPoint[] }> = ({
  operators,
}) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";

  const points = useMemo<SectorMapPoint[]>(
    () =>
      operators
        .filter((o) => o.contractCount > 0)
        .map((o) => {
          const share = o.singleBidShare;
          return {
            id: o.eik,
            loc: o.loc,
            // Rank within a city by single-bid share; unknown sinks to last so a
            // city with any known-share operator colours by that operator.
            value: share == null ? -1 : share,
            color: bandColor(share),
            badge: o.contractCount,
            title: o.name,
            subtitle: `${o.settlement ?? o.oblast ?? ""} · ${
              o.contractCount
            } ${bg ? "договора" : "contracts"}`,
            detail: (
              <>
                <div>
                  {bg ? "Един кандидат" : "Single bidder"}:{" "}
                  <span className="font-semibold tabular-nums">
                    {share == null
                      ? bg
                        ? "няма данни"
                        : "no data"
                      : `${Math.round(share * 100)}%`}
                  </span>
                  {o.bidKnownN > 0 && (
                    <span className="opacity-70">
                      {" "}
                      ({o.singleBidN}/{o.bidKnownN})
                    </span>
                  )}
                </div>
                <div className="opacity-80">
                  {bg ? "Договори на стойност" : "Contracts worth"}:{" "}
                  <span className="font-semibold tabular-nums">
                    {formatEurCompact(o.totalEur, lang)}
                  </span>
                </div>
              </>
            ),
            href: `/awarder/${o.eik}`,
          };
        }),
    [operators, bg, lang],
  );

  if (!points.length) return null;

  return (
    <Card data-og="water-operator-map">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <MapIcon className="h-4 w-4" />
          {bg
            ? "ВиК оператори по конкуренция"
            : "Water operators by competition"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        <SectorPointMap
          points={points}
          groupNoun={bg ? "оператори" : "operators"}
          badgeNoun={bg ? "договора" : "contracts"}
          openLabel={bg ? "Виж оператора" : "Open operator"}
        />

        {/* Legend + caption */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span>
            {bg ? "Дял поръчки с един кандидат:" : "Single-bidder share:"}
          </span>
          {BANDS.map((b) => (
            <span key={b.label} className="inline-flex items-center gap-1">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ background: b.color }}
              />
              {b.label}
            </span>
          ))}
          <span className="inline-flex items-center gap-1">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ background: UNKNOWN_COLOR }}
            />
            {bg ? "няма данни" : "no data"}
          </span>
        </div>
        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? "Всеки маркер е един ВиК оператор по седалище; числото е броят договори, а цветът — делът поръчки само с един кандидат (индикатор за слаба конкуренция). Градовете с няколко оператора се разгръщат в изскачащата карта. Обхватът следва избрания период."
            : "Each marker is one water operator at its seat; the number is its contract count and the colour is the share of contracts with a single bidder (a weak-competition signal). Cities with several operators page through them in the popup. Scope follows the selected period."}
        </p>
      </CardContent>
    </Card>
  );
};
