// The health-pack signature visual: one marker per hospital CITY, coloured by an
// НЗОК spend metric (latest-period БМП payments by default). It answers "where does
// the health money go" at a glance — the biggest university and oblast hospitals in
// Sofia, Plovdiv, Varna light up, and the long tail of small-town facilities fills
// the map. Cities with several hospitals (Sofia has ~30) merge into one marker whose
// badge is the hospital count and whose popup pages through each one, busiest first.
//
// Mirrors /judiciary's CourtLoadMap: the shared SectorPointMap does the markers, this
// screen owns the metric selector, colour banding, legend and caption. Data comes
// from nzok_hospital_map() (migration 075) — geolocated via the EIK → awarder_seats →
// settlements.json bridge, so the browser never geocodes.

import { FC, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Map as MapIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { cn } from "@/lib/utils";
import { formatEurCompact } from "@/lib/currency";
import {
  SectorPointMap,
  type SectorMapPoint,
} from "@/screens/components/maps/SectorPointMap";
import { useNzokHospitalMap } from "@/data/budget/useBudget";
import type { NzokHospitalMapPoint } from "@/data/budget/types";

type Band = { max: number; color: string; label: string };

interface MetricDef {
  id: "paymentsEur" | "drugOverpayEur" | "activityCases";
  bg: string;
  en: string;
  bands: Band[];
  /** How the metric renders in the marker card + legend. */
  isMoney: boolean;
}

// One scale per metric, so the comparison is honest across the whole country. Bands
// are set from the observed per-hospital distribution (q25/q50/q75/q90).
const METRICS: MetricDef[] = [
  {
    id: "paymentsEur",
    bg: "Плащания (БМП)",
    en: "Payments (БМП)",
    isMoney: true,
    bands: [
      { max: 500_000, color: "#15803d", label: "≤ 0.5M" },
      { max: 2_000_000, color: "#65a30d", label: "0.5–2M" },
      { max: 8_000_000, color: "#d97706", label: "2–8M" },
      { max: 20_000_000, color: "#ea580c", label: "8–20M" },
      { max: Infinity, color: "#b91c1c", label: "> 20M" },
    ],
  },
  {
    id: "drugOverpayEur",
    bg: "Надплащане лекарства",
    en: "Drug overpay",
    isMoney: true,
    bands: [
      { max: 10_000, color: "#15803d", label: "≤ 10k" },
      { max: 50_000, color: "#65a30d", label: "10–50k" },
      { max: 120_000, color: "#d97706", label: "50–120k" },
      { max: 200_000, color: "#ea580c", label: "120–200k" },
      { max: Infinity, color: "#b91c1c", label: "> 200k" },
    ],
  },
  {
    id: "activityCases",
    bg: "Случаи (дейност)",
    en: "Cases (activity)",
    isMoney: false,
    bands: [
      { max: 2_000, color: "#15803d", label: "≤ 2k" },
      { max: 10_000, color: "#65a30d", label: "2–10k" },
      { max: 40_000, color: "#d97706", label: "10–40k" },
      { max: 100_000, color: "#ea580c", label: "40–100k" },
      { max: Infinity, color: "#b91c1c", label: "> 100k" },
    ],
  },
];

const bandColor = (bands: Band[], v: number) =>
  (bands.find((b) => v <= b.max) ?? bands[bands.length - 1]).color;

export const NzokHospitalMap: FC = () => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const { data } = useNzokHospitalMap();

  const [metricId, setMetricId] = useState<MetricDef["id"]>("paymentsEur");
  const metric = useMemo(
    () => METRICS.find((m) => m.id === metricId)!,
    [metricId],
  );

  const fmt = useMemo(() => {
    const nf = new Intl.NumberFormat(bg ? "bg-BG" : "en-US", {
      maximumFractionDigits: 0,
    });
    return (v: number) =>
      metric.isMoney ? formatEurCompact(v, i18n.language) : nf.format(v);
  }, [metric.isMoney, bg, i18n.language]);

  const points = useMemo<SectorMapPoint[]>(() => {
    if (!data?.hospitals) return [];
    return data.hospitals
      .filter((h) => h.loc)
      .map((h: NzokHospitalMapPoint) => {
        const value = h[metric.id];
        return {
          id: h.eik,
          loc: h.loc as [number, number],
          value,
          color: bandColor(metric.bands, value),
          badge: 1, // marker sums to the city's hospital count
          title: h.name,
          subtitle: [h.city, h.oblast && h.oblast !== h.city ? h.oblast : null]
            .filter(Boolean)
            .join(" · "),
          detail: (
            <>
              {bg ? metric.bg : metric.en}:{" "}
              <span className="font-semibold tabular-nums">{fmt(value)}</span>
            </>
          ),
          href: `/awarder/${h.eik}`,
        };
      });
  }, [data, metric, bg, fmt]);

  if (!data || !data.hospitals?.length) return null;

  return (
    <Card data-og="nzok-hospital-map">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <MapIcon className="h-4 w-4" />
          {bg
            ? "Къде отиват парите на НЗОК — по болница"
            : "Where НЗОК money goes — hospital by hospital"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        {/* Metric selector */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {bg ? "Показател" : "Metric"}
          </span>
          <div className="inline-flex flex-wrap rounded-lg border p-0.5">
            {METRICS.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setMetricId(m.id)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  metricId === m.id
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {bg ? m.bg : m.en}
              </button>
            ))}
          </div>
        </div>

        <SectorPointMap
          points={points}
          groupNoun={bg ? "болници" : "hospitals"}
          // The badge here is the city's hospital COUNT, so no distinct badgeNoun —
          // that keeps the pager header from reading "30 болници · 30 болници".
          openLabel={bg ? "Виж болницата" : "Open hospital"}
        />

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span>{bg ? metric.bg : metric.en}:</span>
          {metric.bands.map((b) => (
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
            ? `Всеки маркер е един град; числото е броят болници там, а цветът — ${metric.bg.toLowerCase()} на най-голямата от тях. Градовете с няколко болници се разгръщат в изскачащата карта. Показани са ${data.geocoded} от ${data.total} болници с плащания (останалите нямат установено седалище). Данни към ${data.asOf}.`
            : `Each marker is one city; the number is its hospital count and the colour is the largest hospital's ${metric.en.toLowerCase()}. Cities with several hospitals page through them in the popup. Showing ${data.geocoded} of ${data.total} hospitals with payments (the rest have no resolved seat). Data as of ${data.asOf}.`}
        </p>
      </CardContent>
    </Card>
  );
};
