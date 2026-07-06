// €/km against international reference points — the "is this expensive?" answer
// the key-factors prose only gestures at. Each corridor is drawn as its p25–p75
// interquartile band with a median tick on a shared €/km axis, with the World
// Bank ROCKS / BG / RO / GR reference levels marked. Read straight from
// model.corridors (same gated €/km as RoadCostPerKmTile); no engine change.
//
// The references are NOT like-for-like (ROCKS is a two-lane road without
// structures; the country figures are motorways) — the caption keeps that
// honest. The point is orientation, not a league table.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Scale } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import type { CorridorAgg } from "@/lib/roadAttributes";
import { ROAD_EUR_PER_KM } from "@/lib/roadBenchmarks";

// Reference levels (€/km) — shared with the key-factors prose in RoadsPack.
const {
  rocks: ROCKS,
  bgLo: BG_LO,
  bgHi: BG_HI,
  ro: RO,
  gr: GR,
} = ROAD_EUR_PER_KM;

const POINT_REFS = [
  { v: ROCKS, label: "ROCKS", bg: "СБ 2-лентов", en: "WB 2-lane" },
  { v: RO, label: "RO", bg: "Румъния", en: "Romania" },
  { v: GR, label: "GR", bg: "Гърция", en: "Greece" },
];

export const RoadCostBenchmarkTile: FC<{ corridors: CorridorAgg[] }> = ({
  corridors,
}) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;

  const rows = corridors
    .filter((c) => c.eurPerKmMedian != null && c.eurPerKmN > 0 && c.eurPerKmIqr)
    .sort((a, b) => (b.eurPerKmMedian ?? 0) - (a.eurPerKmMedian ?? 0))
    .slice(0, 8);
  if (rows.length < 2) return null;

  const scaleMax = Math.max(
    GR * 1.15,
    ...rows.map((c) => c.eurPerKmIqr?.[1] ?? 0),
  );
  const pct = (v: number) =>
    `${Math.max(0, Math.min(100, (v / scaleMax) * 100))}%`;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <Scale className="h-4 w-4" />
          {lang === "bg"
            ? "Цена на километър спрямо международни ориентири"
            : "Cost per km vs international benchmarks"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4">
        {/* Reference labels row */}
        <div className="relative h-4 mb-1 ml-24">
          {POINT_REFS.map((r) => (
            <span
              key={r.label}
              className="absolute -translate-x-1/2 text-[10px] font-medium text-muted-foreground whitespace-nowrap"
              style={{ left: pct(r.v) }}
              title={lang === "bg" ? r.bg : r.en}
            >
              {r.label}
            </span>
          ))}
        </div>

        <div className="space-y-2">
          {rows.map((c) => {
            const [lo, hi] = c.eurPerKmIqr as [number, number];
            const med = c.eurPerKmMedian ?? 0;
            return (
              <div key={c.corridor} className="flex items-center gap-2 text-xs">
                <span className="w-24 shrink-0 truncate" title={c.corridor}>
                  <span className="font-medium">{c.corridor}</span>
                  <span className="ml-1 text-[10px] text-muted-foreground">
                    {c.roadClass}
                  </span>
                </span>
                <span className="relative flex-1 h-4">
                  {/* BG motorway reference band */}
                  <span
                    className="absolute inset-y-0 bg-emerald-500/10 border-x border-emerald-500/30"
                    style={{
                      left: pct(BG_LO),
                      right: `${100 - parseFloat(pct(BG_HI))}%`,
                    }}
                    aria-hidden
                  />
                  {/* Point reference lines */}
                  {POINT_REFS.map((r) => (
                    <span
                      key={r.label}
                      className="absolute inset-y-0 w-px bg-border"
                      style={{ left: pct(r.v) }}
                      aria-hidden
                    />
                  ))}
                  {/* Corridor IQR band */}
                  <span
                    className="absolute top-1/2 -translate-y-1/2 h-2 rounded-full bg-primary/40"
                    style={{
                      left: pct(lo),
                      width: `${Math.max(1, parseFloat(pct(hi)) - parseFloat(pct(lo)))}%`,
                    }}
                  />
                  {/* Median tick */}
                  <span
                    className="absolute inset-y-0 w-0.5 bg-primary"
                    style={{ left: pct(med) }}
                  />
                </span>
                <span className="w-16 shrink-0 text-right tabular-nums">
                  {formatEurCompact(med, lang)}
                  <span className="text-muted-foreground">/km</span>
                </span>
              </div>
            );
          })}
        </div>

        <p className="mt-2 text-[11px] text-muted-foreground/80">
          {lang === "bg"
            ? "Лентата е p25–p75 на €/км за коридора, чертичката — медианата. Зелената зона е ориентир €3–6 млн/км (ново строителство на магистрала в BG). Ориентирите не са пряко сравними — ROCKS е двулентов път без съоръжения, а страните са магистрали."
            : "Bar is the corridor's p25–p75 €/km, the tick is the median. The green zone marks €3–6M/km (BG new motorway). References are not like-for-like — ROCKS is a two-lane road without structures, the country figures are motorways."}
        </p>
      </CardContent>
    </Card>
  );
};
