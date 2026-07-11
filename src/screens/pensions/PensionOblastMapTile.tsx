// "Средна пенсия по област" — the map the pension debate never gets: НОИ
// publishes an average old-age pension per oblast, but nobody draws it. This
// colours each of the 28 oblasti by its latest-year average and pairs the map
// (the WHERE) with a compact sorted bar list (the exact rank + value). The
// spread is wide — София-град ~1079 лв vs Кърджали ~710 лв, roughly 1.5× — and a
// choropleth makes the north-east / Rhodope band of low pensions legible.
//
// The map machinery is the shared <OblastChoropleth> (navy ramp); this tile owns
// the sorted bar list, the caption, and the spread headline.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Map as MapIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEur, formatInt } from "@/lib/currency";
import { useNoiPensions } from "@/data/budget/useBudget";
import { useNoiPensionsRegional } from "@/data/budget/useNoiPensionsRegional";
import { OblastChoropleth } from "./OblastChoropleth";
import type { NoiPensionOblastRow } from "@/data/budget/types";

// Module-scope accessor: a stable identity so OblastChoropleth's percentile memo
// actually caches (an inline arrow would change every render, defeating it).
const avgPensionOf = (r: NoiPensionOblastRow) => r.avgPensionBgn;

// Sequential fiscal-navy ramp (light → dark), coherent with the budget view;
// higher pension = darker. Dark theme runs muted-navy → bright so the fill reads
// on the navy background. Single hue, monotonic lightness — colourblind-safe.
const RAMP_LIGHT = [
  "hsl(214 45% 90%)",
  "hsl(214 48% 78%)",
  "hsl(214 52% 64%)",
  "hsl(215 56% 50%)",
  "hsl(217 60% 38%)",
  "hsl(219 66% 28%)",
];
const RAMP_DARK = [
  "hsl(214 24% 32%)",
  "hsl(214 30% 42%)",
  "hsl(214 36% 52%)",
  "hsl(214 42% 62%)",
  "hsl(214 48% 72%)",
  "hsl(213 54% 82%)",
];

export const PensionOblastMapTile: FC = () => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const { data } = useNoiPensions();
  const { year, rows, rowForFeature } = useNoiPensionsRegional(data);

  // Descending ranking for the bar list; top 6 + bottom 4 with a gap marker.
  const ranked = useMemo(
    () => [...rows].sort((a, b) => b.avgPensionBgn - a.avgPensionBgn),
    [rows],
  );
  const maxBgn = ranked.length > 0 ? ranked[0].avgPensionBgn : 0;
  const barList = useMemo(() => {
    if (ranked.length <= 12) return ranked.map((r) => ({ row: r, gap: false }));
    const top = ranked.slice(0, 6).map((r) => ({ row: r, gap: false }));
    const bottom = ranked.slice(-4).map((r) => ({ row: r, gap: false }));
    return [...top, { row: ranked[6], gap: true }, ...bottom];
  }, [ranked]);

  if (!data || rows.length === 0) return null;

  const topRow = ranked[0];
  const bottomRow = ranked[ranked.length - 1];
  const ratio =
    bottomRow.avgPensionBgn > 0
      ? topRow.avgPensionBgn / bottomRow.avgPensionBgn
      : null;

  const barWidth = (v: number): string => {
    if (maxBgn <= 0) return "0%";
    // Floor the shortest bar so the lowest oblast still reads as a bar.
    const frac = 0.18 + 0.82 * (v / maxBgn);
    return `${Math.min(100, frac * 100).toFixed(1)}%`;
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <MapIcon className="h-4 w-4" />
            {bg ? "Средна пенсия по област" : "Average pension by oblast"}
          </CardTitle>
          {year != null && (
            <span className="text-xs text-muted-foreground tabular-nums">
              {year}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-3 md:p-4">
        <div className="grid gap-4 md:grid-cols-[3fr_2fr]">
          {/* Map — the WHERE. */}
          <OblastChoropleth
            rows={rows}
            rowForFeature={rowForFeature}
            valueFor={avgPensionOf}
            rampLight={RAMP_LIGHT}
            rampDark={RAMP_DARK}
            heightClass="h-[280px] md:h-[320px]"
            ariaLabel={
              bg
                ? "Карта на средната пенсия по област"
                : "Average-pension map by oblast"
            }
            legendFormat={(v) => `${formatInt(v, lang)} лв`}
            noDataLabel={
              <span className="font-medium">
                {bg ? "Няма данни" : "No data"}
              </span>
            }
            tooltip={(row) => (
              <div className="flex flex-col gap-0.5">
                <span className="font-medium">{row.nameBg}</span>
                <span className="tabular-nums">
                  {formatEur(row.avgPensionEur, lang)} ·{" "}
                  {formatInt(Math.round(row.avgPensionBgn), lang)} лв
                </span>
                {row.yoyPct != null && (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {bg ? "спрямо " : "vs "}
                    {year != null ? year - 1 : ""}:{" "}
                    {row.yoyPct - 1 >= 0 ? "+" : ""}
                    {((row.yoyPct - 1) * 100).toFixed(1)}%
                  </span>
                )}
              </div>
            )}
          />

          {/* Sorted bar list — the exact rank + value. */}
          <ol className="flex flex-col gap-1.5 self-center">
            {barList.map(({ row, gap }) =>
              gap ? (
                <li
                  key="gap"
                  className="py-0.5 text-center text-[10px] text-muted-foreground/60"
                >
                  ···
                </li>
              ) : (
                <li key={row.code} className="flex items-center gap-2 text-xs">
                  <span className="w-24 shrink-0 truncate" title={row.nameBg}>
                    {row.nameBg}
                  </span>
                  <div className="relative h-3 flex-1 rounded-sm bg-muted/40">
                    <div
                      className="absolute inset-y-0 left-0 rounded-sm bg-primary/70"
                      style={{ width: barWidth(row.avgPensionBgn) }}
                    />
                  </div>
                  <span className="w-14 shrink-0 text-right tabular-nums">
                    {formatInt(Math.round(row.avgPensionBgn), lang)}
                  </span>
                </li>
              ),
            )}
          </ol>
        </div>

        <p className="mt-3 text-[11px] text-muted-foreground/80">
          {bg
            ? `Средна пенсия по област (НОИ, ${year ?? ""}). Разликата е голяма — ${topRow.nameBg} ~${formatInt(Math.round(topRow.avgPensionBgn), lang)} лв срещу ${bottomRow.nameBg} ~${formatInt(Math.round(bottomRow.avgPensionBgn), lang)} лв${ratio ? `, около ${ratio.toFixed(1)}×` : ""}. Стойностите са в лева.`
            : `Average pension by oblast (НОИ, ${year ?? ""}). The spread is wide — ${topRow.nameBg} ~${formatInt(Math.round(topRow.avgPensionBgn), lang)} лв against ${bottomRow.nameBg} ~${formatInt(Math.round(bottomRow.avgPensionBgn), lang)} лв${ratio ? `, about ${ratio.toFixed(1)}×` : ""}. Amounts are in leva.`}
        </p>
      </CardContent>
    </Card>
  );
};
