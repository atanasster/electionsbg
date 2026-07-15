// Real visitor-outcome context on /sector/tourism: Bulgaria's tourism
// seasonality (Eurostat nights spent, foreign vs domestic) — the signature
// tourism chart, showing the dominant summer Black Sea peak. This is the "what
// the marketing money buys" side that no ordinary procurement view carries.
//
// NOT ?pscope-scoped: it's a fixed external annual/monthly series (latest full
// calendar year), clearly sourced to Eurostat — not the procurement window.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatCompact } from "@/lib/currency";
import { MONTH_NAMES_BG, MONTH_NAMES_EN } from "@/lib/tourismLabels";
import { useTourismVisitors } from "@/data/tourism/useTourismVisitors";

// Single-letter axis labels are a tile-specific rendering choice (the full names
// come from the shared @/lib/tourismLabels).
const MONTHS_BG = ["Я", "Ф", "М", "А", "М", "Ю", "Ю", "А", "С", "О", "Н", "Д"];
const MONTHS_EN = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

export const TourismSeasonalityTile: FC = () => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const locale = bg ? "bg-BG" : "en-US";
  const { data, isLoading } = useTourismVisitors();

  if (isLoading)
    return (
      <div className="h-[220px] animate-pulse rounded-xl border bg-card" />
    );
  if (!data || data.seasonality.length < 12) return null;

  const months = MONTHS_BG.map((_, i) => (bg ? MONTHS_BG[i] : MONTHS_EN[i]));
  const max = Math.max(
    ...data.seasonality.map((m) => m.foreign + m.domestic),
    1,
  );
  const peak = data.peakMonth;
  const summerPct = Math.round(data.summerShareForeign * 100);
  const latestForeign =
    data.annualForeign[data.annualForeign.length - 1]?.nights ?? 0;

  return (
    <Card className="min-w-0">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          {bg ? "Сезонност на нощувките" : "Overnight-stay seasonality"}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {bg
            ? `Лято (юни–сеп) е ${summerPct}% от чуждестранните нощувки — пик през ${MONTH_NAMES_BG[peak - 1]}. ${data.seasonalityYear}.`
            : `Summer (Jun–Sep) is ${summerPct}% of foreign nights — peak in ${MONTH_NAMES_EN[peak - 1]}. ${data.seasonalityYear}.`}
        </p>
      </CardHeader>
      <CardContent className="p-3 md:p-4">
        <div className="flex h-[150px] items-end gap-1.5">
          {data.seasonality.map((m) => {
            const total = m.foreign + m.domestic;
            const isPeak = m.month === peak;
            return (
              <div
                key={m.month}
                className="flex flex-1 flex-col items-center justify-end gap-1"
                title={`${bg ? MONTH_NAMES_BG[m.month - 1] : MONTH_NAMES_EN[m.month - 1]}: ${formatCompact(m.foreign, locale)} ${bg ? "чужди" : "foreign"} · ${formatCompact(m.domestic, locale)} ${bg ? "местни" : "domestic"}`}
              >
                <div
                  className="flex w-full flex-col justify-end"
                  style={{ height: `${(total / max) * 120}px` }}
                >
                  <div
                    className={
                      "w-full rounded-t " +
                      (isPeak ? "bg-primary" : "bg-primary/75")
                    }
                    style={{ height: `${(m.foreign / total) * 100}%` }}
                  />
                  <div
                    className="w-full bg-muted-foreground/25"
                    style={{ height: `${(m.domestic / total) * 100}%` }}
                  />
                </div>
                <div
                  className={
                    "text-[10px] " +
                    (isPeak
                      ? "font-bold text-foreground"
                      : "text-muted-foreground")
                  }
                >
                  {months[m.month - 1]}
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2 w-3 rounded-sm bg-primary/75" />
            {bg ? "чуждестранни" : "foreign"}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2 w-3 rounded-sm bg-muted-foreground/25" />
            {bg ? "местни" : "domestic"}
          </span>
          <span className="tabular-nums">
            {formatCompact(latestForeign, locale)}{" "}
            {bg
              ? `чужди нощувки (${data.seasonalityYear})`
              : `foreign nights (${data.seasonalityYear})`}
          </span>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          {bg
            ? "Източник: Евростат · tour_occ_nim (хотели)."
            : "Source: Eurostat · tour_occ_nim (hotels)."}
        </p>
      </CardContent>
    </Card>
  );
};
