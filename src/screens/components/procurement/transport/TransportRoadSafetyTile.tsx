// "Пътна безопасност — целта на ЕС за 2030" — the transport-sector road-safety
// outcome. The state's road-safety coordinator is ДАБДП (a transport-group member);
// the money instrument (road building) lives in the separate roads sector, so here we
// frame the OUTCOME against policy: the EU Road Safety Framework 2021-2030 goal to
// HALVE road deaths vs 2019 (628 → 314 for Bulgaria). Reads the Eurostat road-death
// series (data/security/road_safety.json, ingested by scripts/security/fetch_road_safety.ts)
// — no new ingest. National only (Eurostat carries no per-oblast BG road fatalities).

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { TrafficCone } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { dataUrl } from "@/data/dataUrl";

interface RoadSafetyFile {
  source: { label: string; sourceUrl: string; eurostatUpdated: string | null };
  series: { year: number; deaths: number }[];
  latest: { year: number; deaths: number };
  peak: { year: number; deaths: number };
  changeSincePeakPct: number | null;
}

// EU Road Safety Policy Framework 2021-2030: halve road deaths by 2030 vs the 2019
// baseline. If 2019 is missing, fall back to the earliest year on/after 2019.
const TARGET_YEAR = 2030;
const BASELINE_YEAR = 2019;

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

export const TransportRoadSafetyTile: FC = () => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const loc = bg ? "bg-BG" : "en-US";
  const { data } = useRoadSafety();
  if (!data || data.series.length < 2) return null;

  const { latest, peak, changeSincePeakPct } = data;
  // Sort ascending defensively — the baseline fallback (`.find(year >= …)`) and the left
  // axis label (`series[0].year`) both assume chronological order. latest/peak are
  // precomputed in the JSON, so they don't depend on this ordering.
  const series = [...data.series].sort((a, b) => a.year - b.year);
  const baseline =
    series.find((d) => d.year === BASELINE_YEAR) ??
    series.find((d) => d.year >= BASELINE_YEAR) ??
    series[0];
  const target = Math.round(baseline.deaths / 2);

  // Where the linear halving path wants Bulgaria to be in the latest year — so we can
  // say "ahead of / behind the trajectory" honestly.
  const span = TARGET_YEAR - baseline.year;
  const elapsed = Math.min(span, Math.max(0, latest.year - baseline.year));
  const pathNow =
    span > 0
      ? baseline.deaths - ((baseline.deaths - target) * elapsed) / span
      : baseline.deaths;
  const aheadOfTarget = latest.deaths <= pathNow;

  const max = Math.max(...series.map((d) => d.deaths), baseline.deaths, 1);
  const down = (changeSincePeakPct ?? 0) < 0;
  const targetPct = (target / max) * 100; // for the dashed goal line

  return (
    <Card id="road-safety">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <TrafficCone className="h-4 w-4" />
          {bg
            ? "Пътна безопасност — целта за 2030"
            : "Road safety — the 2030 goal"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-2xl font-bold tabular-nums">
            {latest.deaths.toLocaleString(loc)}
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

        {/* Road-death trend with the 2030 target as a dashed goal line. */}
        <div className="relative" style={{ height: 56 }}>
          <div className="flex h-full items-end gap-1">
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
                  style={{ height: `${Math.max(3, (d.deaths / max) * 56)}px` }}
                />
              </div>
            ))}
          </div>
          {/* Dashed 2030 goal line. */}
          <div
            className="pointer-events-none absolute inset-x-0 border-t border-dashed border-emerald-600/70"
            style={{ bottom: `${targetPct}%` }}
          >
            <span className="absolute -top-4 right-0 rounded bg-emerald-600/10 px-1 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
              {bg ? `цел 2030: ${target}` : `2030 goal: ${target}`}
            </span>
          </div>
        </div>
        <div className="flex justify-between text-[10px] tabular-nums text-muted-foreground">
          <span>{series[0].year}</span>
          <span>{latest.year}</span>
        </div>

        <p className="text-sm leading-snug">
          {bg ? (
            <>
              Целта на ЕС е броят на загиналите да се намали наполовина до 2030
              г. спрямо {baseline.year} г. ({baseline.deaths} →{" "}
              <span className="font-semibold">{target}</span>). През{" "}
              {latest.year} България е{" "}
              <span
                className={`font-semibold ${aheadOfTarget ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}
              >
                {aheadOfTarget ? "пред" : "зад"}
              </span>{" "}
              траекторията за целта. Координатор е ДАБДП; строителството на
              пътища е в отделния сектор „Пътища“.
            </>
          ) : (
            <>
              The EU goal is to halve road deaths by 2030 vs {baseline.year} (
              {baseline.deaths} →{" "}
              <span className="font-semibold">{target}</span>
              ). In {latest.year} Bulgaria is{" "}
              <span
                className={`font-semibold ${aheadOfTarget ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}
              >
                {aheadOfTarget ? "ahead of" : "behind"}
              </span>{" "}
              the target trajectory. ДАБДП coordinates road safety; road
              building is in the separate Roads sector.
            </>
          )}
        </p>

        <p className="text-[11px] text-muted-foreground/80">
          {bg ? "Източник: " : "Source: "}
          Eurostat sdg_11_40 ({bg ? "загинали на пътя" : "road-traffic deaths"})
        </p>
      </CardContent>
    </Card>
  );
};
