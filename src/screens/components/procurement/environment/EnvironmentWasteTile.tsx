// „Рециклиране на отпадъци — спрямо целта на ЕС" (§5 tile 6) — the second measured
// outcome loop beside the money. Bulgaria's municipal-recycling rate against the two
// hard EU targets (55% by 2025, 65% by 2035, Waste Framework Directive 2018/851). BG
// peaked ~35% (2020) then fell to ~17% (2023) — far below target and below the EU
// average. Context, not a spend-causation claim; the fund/waste-CPV spend half is the
// ПУДООС grant register (Phase 2, deferred).
//
// CSS flex bars (OG-screenshottable), a fixed green/amber/red ramp keyed to the 55%
// target — not rank. Reads the tiny data/environment/waste.json (Eurostat).

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Recycle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { useWaste } from "@/data/environment/useWaste";

// Scale the chart so the 65% (2035) target line sits comfortably inside the frame.
const SCALE_MAX = 70;
const CHART_H = 96;

// Distance-to-2025-target ramp: green ≥ target, amber within 20pp, red further.
const rateColor = (v: number, target: number): string =>
  v >= target ? "#15803d" : v >= target - 20 ? "#d97706" : "#b91c1c";

export const EnvironmentWasteTile: FC = () => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const loc = bg ? "bg-BG" : "en-US";
  const { data } = useWaste();
  if (!data) return null;

  const bgSeries = data.recyclingRate.byGeo.BG ?? [];
  const euSeries = data.recyclingRate.byGeo.EU27_2020 ?? [];
  if (bgSeries.length < 3) return null;

  const latest = bgSeries[bgSeries.length - 1];
  const euLatest = euSeries[euSeries.length - 1];
  const target = data.targets.y2025;
  const gap = target - latest.value;
  const perCapita = data.wastePerCapita.byGeo.BG ?? [];
  const perCapitaLatest = perCapita[perCapita.length - 1];

  // Only show a readable number of recent years.
  const bars = bgSeries.slice(-12);
  const y = (v: number) => (Math.min(v, SCALE_MAX) / SCALE_MAX) * CHART_H;

  return (
    <Card id="waste">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Recycle className="h-4 w-4" />
          {bg
            ? "Рециклиране на отпадъци — спрямо целта на ЕС"
            : "Waste recycling — vs the EU target"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span
            className="text-2xl font-bold tabular-nums"
            style={{ color: rateColor(latest.value, target) }}
          >
            {latest.value.toLocaleString(loc, { maximumFractionDigits: 1 })}%
          </span>
          <span className="text-xs text-muted-foreground">
            {bg
              ? `рециклирани битови отпадъци, ${latest.year} г. (цел на ЕС: ${target}% до 2025)`
              : `municipal waste recycled, ${latest.year} (EU target: ${target}% by 2025)`}
          </span>
          {gap > 0 && (
            <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
              {bg
                ? `${gap.toLocaleString(loc, { maximumFractionDigits: 0 })} пункта под целта`
                : `${gap.toLocaleString(loc, { maximumFractionDigits: 0 })} pts below target`}
            </span>
          )}
        </div>

        {/* Trend bars with the 2025 (55%) and 2035 (65%) target reference lines. */}
        <div className="relative" style={{ height: CHART_H }}>
          {/* Target lines */}
          {[
            { v: data.targets.y2025, label: `${data.targets.y2025}% · 2025` },
            { v: data.targets.y2035, label: `${data.targets.y2035}% · 2035` },
          ].map((t) => (
            <div
              key={t.v}
              className="absolute left-0 right-0 border-t border-dashed border-muted-foreground/50"
              style={{ bottom: y(t.v) }}
            >
              <span className="absolute right-0 -top-3.5 text-[9px] text-muted-foreground">
                {bg ? `цел ${t.label}` : `target ${t.label.replace("·", "by")}`}
              </span>
            </div>
          ))}
          {/* EU average reference line */}
          {euLatest && (
            <div
              className="absolute left-0 right-0 border-t border-dotted border-sky-500/70"
              style={{ bottom: y(euLatest.value) }}
            >
              <span className="absolute left-0 -top-3.5 text-[9px] text-sky-600 dark:text-sky-400">
                {bg ? "ЕС средно" : "EU avg"}{" "}
                {euLatest.value.toLocaleString(loc, {
                  maximumFractionDigits: 0,
                })}
                %
              </span>
            </div>
          )}
          {/* BG bars */}
          <div className="absolute inset-0 flex items-end gap-1">
            {bars.map((p) => (
              <div
                key={p.year}
                className="flex-1"
                title={`${p.year}: ${p.value}%`}
              >
                <div
                  className="w-full rounded-t"
                  style={{
                    height: Math.max(2, y(p.value)),
                    background:
                      p.year === latest.year
                        ? rateColor(p.value, target)
                        : `${rateColor(p.value, target)}66`,
                  }}
                />
              </div>
            ))}
          </div>
        </div>
        <div className="flex justify-between text-[10px] tabular-nums text-muted-foreground">
          <span>{bars[0].year}</span>
          <span>{latest.year}</span>
        </div>

        <p className="text-sm leading-snug">
          {bg ? (
            <>
              България рециклира{" "}
              <span className="font-semibold tabular-nums">
                {latest.value.toLocaleString(loc, { maximumFractionDigits: 1 })}
                %
              </span>{" "}
              от битовите си отпадъци — под целта на ЕС от{" "}
              <span className="font-semibold">{target}%</span> за 2025 г.
              {euLatest ? (
                <>
                  {" "}
                  и доста под средното за ЕС (
                  {euLatest.value.toLocaleString(loc, {
                    maximumFractionDigits: 0,
                  })}
                  %)
                </>
              ) : null}
              .
              {perCapitaLatest ? (
                <>
                  {" "}
                  Същевременно образуваните отпадъци на човек растат до{" "}
                  <span className="font-semibold tabular-nums">
                    {perCapitaLatest.value.toLocaleString(loc, {
                      maximumFractionDigits: 0,
                    })}{" "}
                    кг
                  </span>{" "}
                  ({perCapitaLatest.year} г.).
                </>
              ) : null}
            </>
          ) : (
            <>
              Bulgaria recycles{" "}
              <span className="font-semibold tabular-nums">
                {latest.value.toLocaleString(loc, { maximumFractionDigits: 1 })}
                %
              </span>{" "}
              of its municipal waste — below the EU{" "}
              <span className="font-semibold">{target}%</span> target for 2025
              {euLatest ? (
                <>
                  {" "}
                  and well under the EU average (
                  {euLatest.value.toLocaleString(loc, {
                    maximumFractionDigits: 0,
                  })}
                  %)
                </>
              ) : null}
              .
              {perCapitaLatest ? (
                <>
                  {" "}
                  Meanwhile waste generated per person has risen to{" "}
                  <span className="font-semibold tabular-nums">
                    {perCapitaLatest.value.toLocaleString(loc, {
                      maximumFractionDigits: 0,
                    })}{" "}
                    kg
                  </span>{" "}
                  ({perCapitaLatest.year}).
                </>
              ) : null}
            </>
          )}
        </p>

        <p className="text-[11px] text-muted-foreground/80">
          {bg ? "Източник: " : "Source: "}
          Eurostat cei_wm011 ({bg ? "степен на рециклиране" : "recycling rate"})
          + env_wasmun ({bg ? "отпадъци на човек" : "waste per capita"}).{" "}
          {bg
            ? "Целите са по Рамковата директива за отпадъците (2018/851). Показва резултат, не разход."
            : "Targets per the Waste Framework Directive (2018/851). An outcome, not a spend figure."}
        </p>
      </CardContent>
    </Card>
  );
};
