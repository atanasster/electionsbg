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
  // Compare LIKE YEARS. Eurostat publishes the EU aggregate ahead of Bulgaria —
  // today BG ends 2023 and EU27 ends 2024 — so taking each series' own last
  // point silently compares two different years, and neither figure carried a
  // year label to give it away. Prefer the EU point at BG's year; where there is
  // none, fall back to the EU's latest and RENDER its year, so a mismatched
  // comparison is visible rather than implied.
  const euSameYear = euSeries.find((p) => p.year === latest.year);
  const euRef = euSameYear ?? euSeries[euSeries.length - 1];
  const euYearDiffers = !!euRef && euRef.year !== latest.year;
  const target = data.targets.y2025;
  const gap = target - latest.value;
  // The comparatives below are CLAIMS, so they are derived rather than asserted.
  // Both were unconditional prose while the „N пункта под целта" chip beside them
  // was already guarded on `gap > 0` — so at a BG rate above 55% the tile would
  // have said „под целта" with the chip correctly absent, contradicting itself on
  // one line. Bulgaria is a long way below both today; that is not a licence to
  // hard-code the direction.
  const belowTarget = latest.value < target;
  const belowEu = !!euRef && latest.value < euRef.value;
  const perCapita = data.wastePerCapita.byGeo.BG ?? [];
  const perCapitaLatest = perCapita[perCapita.length - 1];
  // „Waste per person is rising to 490 kg" is true of the recent trend and reads
  // as an all-time high, which it is not — the series starts at 554 kg in 2010.
  // So name the low point it has risen FROM, and let the reader see both ends.
  const perCapitaTrough = perCapita.length
    ? perCapita.reduce((lo, p) => (p.value <= lo.value ? p : lo))
    : undefined;
  const perCapitaRising =
    !!perCapitaLatest &&
    !!perCapitaTrough &&
    perCapitaTrough.year < perCapitaLatest.year &&
    perCapitaLatest.value > perCapitaTrough.value;

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
          {/* EU average reference line — at BG's year where Eurostat has it. */}
          {euRef && (
            <div
              className="absolute left-0 right-0 border-t border-dotted border-sky-500/70"
              style={{ bottom: y(euRef.value) }}
            >
              <span className="absolute left-0 -top-3.5 text-[9px] text-sky-600 dark:text-sky-400">
                {bg ? "ЕС средно" : "EU avg"}{" "}
                {euRef.value.toLocaleString(loc, {
                  maximumFractionDigits: 0,
                })}
                %{euYearDiffers ? ` (${euRef.year})` : ""}
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
              от битовите си отпадъци ({latest.year} г.) —{" "}
              {belowTarget ? "под" : "над"} целта на ЕС от{" "}
              <span className="font-semibold">{target}%</span> за 2025 г.
              {euRef ? (
                <>
                  {" "}
                  и {belowEu ? "под" : "над"} средното за ЕС (
                  {euRef.value.toLocaleString(loc, {
                    maximumFractionDigits: 0,
                  })}
                  %{euYearDiffers ? ` за ${euRef.year} г.` : ""})
                </>
              ) : null}
              .
              {perCapitaLatest ? (
                <>
                  {" "}
                  Същевременно образуваните отпадъци на човек са{" "}
                  <span className="font-semibold tabular-nums">
                    {perCapitaLatest.value.toLocaleString(loc, {
                      maximumFractionDigits: 0,
                    })}{" "}
                    кг
                  </span>{" "}
                  ({perCapitaLatest.year} г.)
                  {perCapitaRising && perCapitaTrough
                    ? ` — нагоре от ${perCapitaTrough.value.toLocaleString(loc, { maximumFractionDigits: 0 })} кг през ${perCapitaTrough.year} г.`
                    : "."}
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
              of its municipal waste ({latest.year}) —{" "}
              {belowTarget ? "below" : "above"} the EU{" "}
              <span className="font-semibold">{target}%</span> target for 2025
              {euRef ? (
                <>
                  {" "}
                  and {belowEu ? "under" : "over"} the EU average (
                  {euRef.value.toLocaleString(loc, {
                    maximumFractionDigits: 0,
                  })}
                  %{euYearDiffers ? ` in ${euRef.year}` : ""})
                </>
              ) : null}
              .
              {perCapitaLatest ? (
                <>
                  {" "}
                  Meanwhile waste generated per person stands at{" "}
                  <span className="font-semibold tabular-nums">
                    {perCapitaLatest.value.toLocaleString(loc, {
                      maximumFractionDigits: 0,
                    })}{" "}
                    kg
                  </span>{" "}
                  ({perCapitaLatest.year})
                  {perCapitaRising && perCapitaTrough
                    ? ` — up from ${perCapitaTrough.value.toLocaleString(loc, { maximumFractionDigits: 0 })} kg in ${perCapitaTrough.year}`
                    : ""}
                  .
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
