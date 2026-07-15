// "Пътна безопасност — загинали на пътя" — the first spend-vs-outcome tile (plan
// §7a #1 / Phase 3). Road-traffic deaths are the outcome the МВР traffic police
// (Пътна полиция / КАТ) and the patrol-car procurement are meant to move. Reads the
// Eurostat road-death series (data/security/road_safety.json, ingested by
// scripts/security/fetch_road_safety.ts) and pairs it with the group's vehicle
// procurement — honestly framed (correlation, not causation; many factors drive
// road safety). National only (Eurostat carries no per-oblast road fatalities for BG).

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { TrafficCone } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import { dataUrl } from "@/data/dataUrl";

interface RoadSafetyFile {
  source: { label: string; sourceUrl: string; eurostatUpdated: string | null };
  series: { year: number; deaths: number }[];
  latest: { year: number; deaths: number };
  peak: { year: number; deaths: number };
  changeSincePeakPct: number | null;
}

const useRoadSafety = () =>
  useQuery({
    queryKey: ["security", "road_safety"] as const,
    queryFn: async (): Promise<RoadSafetyFile | null> => {
      const r = await fetch(dataUrl("/security/road_safety.json"));
      if (!r.ok) return null;
      return r.json();
    },
    staleTime: Infinity,
  });

export const MvrRoadSafetyTile: FC<{ vehicleEur: number }> = ({
  vehicleEur,
}) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const { data } = useRoadSafety();
  if (!data || data.series.length < 2) return null;

  const { series, latest, peak, changeSincePeakPct } = data;
  const max = Math.max(...series.map((d) => d.deaths), 1);
  const down = (changeSincePeakPct ?? 0) < 0;

  return (
    <Card id="road-safety">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <TrafficCone className="h-4 w-4" />
          {bg ? "Пътна безопасност" : "Road safety"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-2xl font-bold tabular-nums">
            {latest.deaths.toLocaleString(bg ? "bg-BG" : "en-US")}
          </span>
          <span className="text-xs text-muted-foreground">
            {bg
              ? `загинали на пътя, ${latest.year} г.`
              : `road deaths, ${latest.year}`}
          </span>
          {changeSincePeakPct != null && (
            <span
              className={`text-xs font-medium ${down ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}
            >
              {changeSincePeakPct > 0 ? "+" : ""}
              {changeSincePeakPct}%{" "}
              {bg ? `спрямо пика (${peak.year})` : `vs peak (${peak.year})`}
            </span>
          )}
        </div>

        {/* Road-death trend — bars, latest highlighted. */}
        <div className="flex items-end gap-1" style={{ height: 48 }}>
          {series.map((d) => (
            <div
              key={d.year}
              className="flex-1"
              title={`${d.year}: ${d.deaths}`}
            >
              <div
                className={`w-full rounded-t ${
                  d.year === latest.year
                    ? "bg-primary"
                    : d.year === peak.year
                      ? "bg-red-500/60"
                      : "bg-primary/30"
                }`}
                style={{ height: `${Math.max(3, (d.deaths / max) * 48)}px` }}
              />
            </div>
          ))}
        </div>
        <div className="flex justify-between text-[10px] tabular-nums text-muted-foreground">
          <span>{series[0].year}</span>
          <span>{latest.year}</span>
        </div>

        <p className="text-sm leading-snug">
          {bg ? (
            <>
              Инструментът на МВР е Пътна полиция (КАТ) и патрулните автомобили
              —{" "}
              <span className="font-semibold tabular-nums">
                {formatEurCompact(vehicleEur, lang)}
              </span>{" "}
              договорени за автомобили и техника. Пътната безопасност зависи от
              много фактори; това е контекст, не причинно-следствена връзка.
            </>
          ) : (
            <>
              МВР's instrument is the traffic police (КАТ) and patrol vehicles —{" "}
              <span className="font-semibold tabular-nums">
                {formatEurCompact(vehicleEur, lang)}
              </span>{" "}
              contracted for vehicles & equipment. Road safety has many drivers;
              this is context, not causation.
            </>
          )}
        </p>

        <p className="text-[11px] text-muted-foreground/80">
          {bg ? "Източник: " : "Source: "}
          Eurostat sdg_11_40 ·{" "}
          {bg ? "поръчки: АОП/ЦАИС ЕОП" : "procurement: АОП/ЦАИС ЕОП"}
        </p>
      </CardContent>
    </Card>
  );
};
