// The /judiciary signature visual: one ranked "#N" badge per court, coloured by its
// ДЕЙСТВИТЕЛНА натовареност (cases per judge per month) — #1 is the busiest bench.
// The story it tells is that the load is wildly uneven, with the smallest районни
// courts often the most loaded per judge while the appellate benches sit light.
//
// Filter by year (from the page scope), indicator, and court type. The map itself is
// the shared SectorPointMap (reused across sector dashboards); this screen owns the
// controls, colour banding and legend around it.

import { FC, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Map as MapIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { cn } from "@/lib/utils";
import {
  SectorPointMap,
  type SectorMapPoint,
} from "@/screens/components/maps/SectorPointMap";
import type { CourtLoad, LoadMetric } from "@/data/judiciary/useCourtLoad";

// One scale for every court, so the comparison is honest: an appellate bench really
// does carry far fewer cases per judge than a районен one. Bands mirror the load a
// single judge clears in a month.
const BANDS: { max: number; color: string; label: string }[] = [
  { max: 15, color: "#15803d", label: "≤ 15" }, // green-700
  { max: 35, color: "#65a30d", label: "15–35" }, // lime-600
  { max: 45, color: "#d97706", label: "35–45" }, // amber-600
  { max: 55, color: "#ea580c", label: "45–55" }, // orange-600
  { max: Infinity, color: "#b91c1c", label: "> 55" }, // red-700
];
const bandColor = (v: number) =>
  (BANDS.find((b) => v <= b.max) ?? BANDS[BANDS.length - 1]).color;

const TIERS: { id: string; bg: string; en: string }[] = [
  { id: "rs_oblast", bg: "Районни (центрове)", en: "District (centres)" },
  { id: "rs_izvan", bg: "Районни (извън)", en: "District (outside)" },
  { id: "okrazhni", bg: "Окръжни", en: "Regional" },
  { id: "administrativni", bg: "Административни", en: "Administrative" },
  { id: "apelativni", bg: "Апелативни", en: "Appellate" },
  { id: "voenni", bg: "Военни", en: "Military" },
];
const tierLabel = (id: string, bg: boolean) => {
  const t = TIERS.find((x) => x.id === id);
  return t ? (bg ? t.bg : t.en) : id;
};

const METRICS: { id: LoadMetric; bg: string; en: string }[] = [
  { id: "filedPerMonth", bg: "Постъпили", en: "Filed" },
  { id: "considerPerMonth", bg: "За разглеждане", en: "To consider" },
  { id: "resolvedPerMonth", bg: "Свършени", en: "Resolved" },
];

export const CourtLoadMap: FC<{
  year: number;
  courts: CourtLoad[];
}> = ({ year, courts }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";

  // Default to „за разглеждане" (considerPerMonth) so the map's „busiest" court agrees
  // with the judiciaryCourtLoad AI tool + narrate, which rank on the same indicator.
  const [metric, setMetric] = useState<LoadMetric>("considerPerMonth");
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const metricLabel = useMemo(
    () => METRICS.find((m) => m.id === metric)!,
    [metric],
  );
  const fmt = useCallback(
    (v: number) =>
      v.toLocaleString(bg ? "bg-BG" : "en-US", { maximumFractionDigits: 1 }),
    [bg],
  );

  const points = useMemo<SectorMapPoint[]>(() => {
    return courts
      .filter((c) => c.loc && !hidden.has(c.tier))
      .map((c: CourtLoad) => {
        const value = c[metric];
        return {
          id: c.name,
          loc: c.loc as [number, number],
          value,
          color: bandColor(value),
          badge: c.judges,
          title: c.name,
          subtitle: `${tierLabel(c.tier, bg)} · ${c.judges} ${
            bg ? "съдии" : "judges"
          }`,
          detail: (
            <>
              {bg ? metricLabel.bg : metricLabel.en}:{" "}
              <span className="font-semibold tabular-nums">{fmt(value)}</span>{" "}
              <span className="opacity-70">
                {bg ? "дела/съдия/мес." : "cases/judge/mo."}
              </span>
            </>
          ),
        };
      });
  }, [courts, hidden, metric, bg, metricLabel, fmt]);

  if (!courts.length) return null;

  const toggleTier = (id: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Card data-og="judiciary-court-map">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <MapIcon className="h-4 w-4" />
          {bg
            ? "Натовареност на съдилищата по съд"
            : "Court workload, court by court"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        {/* Indicator selector */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {bg ? "Показател (дела/съдия/мес.)" : "Indicator (cases/judge/mo.)"}
          </span>
          <div className="inline-flex rounded-lg border p-0.5">
            {METRICS.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setMetric(m.id)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  metric === m.id
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {bg ? m.bg : m.en}
              </button>
            ))}
          </div>
        </div>

        {/* Court-type toggles */}
        <div className="flex flex-wrap items-center gap-1.5">
          {TIERS.map((tt) => {
            const on = !hidden.has(tt.id);
            return (
              <button
                key={tt.id}
                type="button"
                onClick={() => toggleTier(tt.id)}
                className={cn(
                  "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                  on
                    ? "border-primary/40 bg-primary/10 text-foreground"
                    : "border-border text-muted-foreground/60 line-through",
                )}
              >
                {bg ? tt.bg : tt.en}
              </button>
            );
          })}
        </div>

        <SectorPointMap
          points={points}
          groupNoun={bg ? "съдилища" : "courts"}
          badgeNoun={bg ? "съдии" : "judges"}
        />

        {/* Legend + caption */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span>
            {bg ? "Дела на съдия месечно:" : "Cases per judge monthly:"}
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
        </div>
        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? `Всеки маркер е един град през ${year} г.; числото е броят съдии там, а цветът — действителната натовареност на най-натоварения съд (${metricLabel.bg.toLowerCase()} дела на един съдия месечно). Градовете с няколко съдилища се разгръщат в изскачащата карта.`
            : `Each marker is one city in ${year}; the number is its judge count and the colour is the busiest court's actual workload (${metricLabel.en.toLowerCase()} cases per judge per month). Cities with several courts page through them in the popup.`}
        </p>
      </CardContent>
    </Card>
  );
};
