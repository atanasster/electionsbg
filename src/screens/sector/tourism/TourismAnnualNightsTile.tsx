// Annual overnight stays in Bulgaria, all tourist accommodation (Eurostat
// tour_occ_ninat, NACE I551-I553), split foreign / domestic, 2013 onward. The
// seasonality tile beside it reads the HOTELS-only monthly series; this one is
// the broader official annual total, so the two are labelled by source and
// never summed together.
//
// NOT ?pscope-scoped: a fixed external annual series, like its neighbours.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatCompact } from "@/lib/currency";
import { useTourismVisitors } from "@/data/tourism/useTourismVisitors";
import { ChartGhost } from "@/ux/motion/ChartGhost";

const PRE_COVID_YEAR = 2019;

export const TourismAnnualNightsTile: FC = () => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const locale = bg ? "bg-BG" : "en-US";
  const { data, isLoading } = useTourismVisitors();

  if (isLoading) return <ChartGhost className="h-[220px]" />;
  const rows = data?.annualNights;
  if (!rows || rows.length < 5) return null;

  const latest = rows[rows.length - 1];
  const max = Math.max(...rows.map((r) => r.total), 1);
  const isRecord = latest.total === max;
  const base = rows.find((r) => r.year === PRE_COVID_YEAR);
  const vsBase = base
    ? Math.round((latest.total / base.total - 1) * 100)
    : null;
  const foreignPct = Math.round((latest.foreign / latest.total) * 100);
  const total = formatCompact(latest.total, locale);
  const signed = (n: number) => `${n > 0 ? "+" : ""}${n}%`;

  return (
    <Card className="min-w-0">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          {bg ? "Нощувки по години" : "Overnight stays by year"}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {bg
            ? `${latest.year}: ${total} нощувки${isRecord ? " — най-много от 2013 г." : ""}${vsBase !== null ? ` ${signed(vsBase)} спрямо ${PRE_COVID_YEAR} г.` : ""} Чужденците са ${foreignPct}%.`
            : `${latest.year}: ${total} nights${isRecord ? " — the most since 2013" : ""}${vsBase !== null ? `, ${signed(vsBase)} vs ${PRE_COVID_YEAR}` : ""}. Foreign guests are ${foreignPct}%.`}
        </p>
      </CardHeader>
      <CardContent className="p-3 md:p-4">
        <div className="flex h-[150px] items-end gap-1.5">
          {rows.map((r) => {
            const isLatest = r.year === latest.year;
            return (
              <div
                key={r.year}
                className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1"
                title={`${r.year}: ${formatCompact(r.total, locale)} ${bg ? "общо" : "total"} · ${formatCompact(r.foreign, locale)} ${bg ? "чужди" : "foreign"} · ${formatCompact(r.domestic, locale)} ${bg ? "местни" : "domestic"}`}
              >
                {isLatest && (
                  <div className="text-[10px] font-semibold tabular-nums text-foreground">
                    {total}
                  </div>
                )}
                <div
                  className="flex w-full flex-col justify-end gap-[2px]"
                  style={{ height: `${(r.total / max) * 112}px` }}
                >
                  <div
                    className={
                      "w-full rounded-t " +
                      (isLatest ? "bg-primary" : "bg-primary/75")
                    }
                    style={{ height: `${(r.foreign / r.total) * 100}%` }}
                  />
                  <div
                    className="w-full bg-muted-foreground/25"
                    style={{ height: `${(r.domestic / r.total) * 100}%` }}
                  />
                </div>
                <div
                  className={
                    "text-[10px] tabular-nums " +
                    (isLatest
                      ? "font-bold text-foreground"
                      : "text-muted-foreground")
                  }
                >
                  {String(r.year).slice(2)}
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
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          {bg
            ? "Източник: Евростат · tour_occ_ninat (всички места за настаняване — хотели, почивни и кратковременни, къмпинги)."
            : "Source: Eurostat · tour_occ_ninat (all tourist accommodation — hotels, holiday and short-stay, campsites)."}
        </p>
      </CardContent>
    </Card>
  );
};
