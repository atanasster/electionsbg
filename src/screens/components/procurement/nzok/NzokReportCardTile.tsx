// "Как се сравнява болницата" — the CMS Care Compare report card on a hospital's
// /company/:eik page (migration 056). For each curated financial RATIO measure it
// shows the hospital's value badged against the national median — над / около /
// под медианата — using the p40/p60 tolerance band for the "around" middle state
// (so noise near the median isn't over-flagged). Only the two measures with an
// unambiguous good direction (overdue-debt share, bed occupancy) carry colour;
// the rest are positional, because case-mix legitimately drives cost-per-patient,
// ALOS, personnel share, etc.
//
// Selecting a measure reveals its DECILE FAN over time — the whole peer
// distribution as p10..p90 bands with this hospital threaded through — the
// OpenPrescribing "you are here, and here is how everyone moved" chart. Together
// they answer "is this hospital an outlier, or just different?" honestly.

import { FC, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ClipboardList } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useNzokFinancialsMeasuresByEik,
  useNzokFinancialsMeasureFan,
  useNzokFinancialsCoverageByEik,
  useNzokCasemixByEik,
} from "@/data/budget/useBudget";
import { formatEur } from "@/lib/currency";
import {
  NZOK_MEASURES,
  nzokMeasure,
  formatMeasureValue,
  measureStanding,
  standingTone,
  standingLabel,
} from "@/lib/nzokMeasures";

const toneClass = (tone: "good" | "bad" | "neutral"): string =>
  tone === "good"
    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
    : tone === "bad"
      ? "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300"
      : "bg-muted text-muted-foreground";

export const NzokReportCardTile: FC<{ eik: string }> = ({ eik }) => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const { data } = useNzokFinancialsMeasuresByEik(eik);
  const [measure, setMeasure] = useState<string>(NZOK_MEASURES[0].key);
  const fan = useNzokFinancialsMeasureFan(measure, eik);
  const coverage = useNzokFinancialsCoverageByEik(eik);
  const casemix = useNzokCasemixByEik(eik);

  if (!data || !data.measures?.length) return null;

  const byKey = new Map(data.measures.map((m) => [m.measure, m]));
  // Preserve the registry's display order.
  const rows = NZOK_MEASURES.map((def) => ({
    def,
    m: byKey.get(def.key),
  })).filter(
    (
      r,
    ): r is {
      def: (typeof NZOK_MEASURES)[number];
      m: NonNullable<ReturnType<typeof byKey.get>>;
    } => !!r.m,
  );

  const fanRows =
    fan.data?.series.map((p) => ({
      quarter: p.quarter,
      band9010: [p.p10, p.p90] as [number, number],
      band7525: [p.p25, p.p75] as [number, number],
      median: p.median,
      value: p.value,
    })) ?? [];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardList className="h-4 w-4 text-teal-600 dark:text-teal-400" />
          {bg ? "Как се сравнява болницата" : "How this hospital compares"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 p-3 md:p-4">
        <p className="text-xs text-muted-foreground">
          {bg
            ? `Показатели за ${data.quarter} спрямо националната медиана на всички болници с поне 20 легла. Цветът маркира само двата показателя с ясна „добра" посока; останалите са позиционни — профилът на болницата обяснява голяма част от разликите.`
            : `Indicators for ${data.quarter} against the national median of all hospitals with at least 20 beds. Colour marks only the two measures with a clear “good” direction; the rest are positional — case-mix explains much of the variation.`}
        </p>

        {/* Case-mix expected-vs-actual (migration 059) — appears only once the НРД
            pathway tariffs are loaded. "Paid X× what its case-mix predicts at list
            price." A signpost for надлимитна/coding differences, not a verdict. */}
        {casemix.data && casemix.data.ratio != null && (
          <div className="rounded-lg border bg-muted/30 p-3 text-xs">
            <span className="font-medium">
              {bg ? "Плащане спрямо case-mix: " : "Payment vs case-mix: "}
            </span>
            <span className="tabular-nums font-semibold text-teal-700 dark:text-teal-300">
              {casemix.data.ratio.toFixed(2)}×
            </span>{" "}
            <span className="text-muted-foreground">
              {bg
                ? `(платени ${formatEur(casemix.data.actualEur ?? 0, i18n.language, { decimals: 0 })} спрямо очаквани ${formatEur(casemix.data.expectedEur, i18n.language, { decimals: 0 })} по НРД цена за ${casemix.data.year} г. — знак за проверка, не присъда; покритие ${Math.round(casemix.data.coverage * 100)}% от случаите)`
                : `(paid ${formatEur(casemix.data.actualEur ?? 0, i18n.language, { decimals: 0 })} vs an expected ${formatEur(casemix.data.expectedEur, i18n.language, { decimals: 0 })} at НРД list price for ${casemix.data.year} — a signpost, not a verdict; ${Math.round(casemix.data.coverage * 100)}% of cases priced)`}
            </span>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr className="border-b">
                <th className="py-1.5 pr-2 text-left font-normal">
                  {bg ? "Показател" : "Measure"}
                </th>
                <th className="py-1.5 pr-2 text-right font-normal">
                  {bg ? "Стойност" : "Value"}
                </th>
                <th className="py-1.5 pr-2 text-right font-normal">
                  {bg ? "Медиана" : "Median"}
                </th>
                <th className="py-1.5 text-right font-normal">
                  {bg ? "Спрямо медианата" : "vs median"}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map(({ def, m }) => {
                const standing = measureStanding(m.value, m.p40, m.p60);
                const tone = standingTone(def.polarity, standing);
                return (
                  <tr key={def.key} className="align-top">
                    <td className="py-2 pr-2">
                      <div className="font-medium">
                        {bg ? def.titleBg : def.titleEn}
                      </div>
                      <div className="mt-0.5 text-[10px] leading-snug text-muted-foreground">
                        {bg ? def.whyBg : def.whyEn}
                      </div>
                    </td>
                    <td className="py-2 pr-2 text-right align-middle tabular-nums font-medium">
                      {formatMeasureValue(def.key, m.value, i18n.language)}
                    </td>
                    <td className="py-2 pr-2 text-right align-middle tabular-nums text-muted-foreground">
                      {bg ? "мед. " : "med. "}
                      {formatMeasureValue(def.key, m.median, i18n.language)}
                    </td>
                    <td className="py-2 text-right align-middle">
                      <span
                        className={`inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-medium ${toneClass(
                          tone,
                        )}`}
                      >
                        {standingLabel(standing, i18n.language)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Decile fan for the picked measure. */}
        <div className="space-y-2 border-t pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {bg ? "Разпределение във времето:" : "Distribution over time:"}
            </span>
            <Select value={measure} onValueChange={setMeasure}>
              <SelectTrigger className="h-7 w-auto min-w-[200px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {NZOK_MEASURES.map((def) => (
                  <SelectItem key={def.key} value={def.key} className="text-xs">
                    {bg ? def.titleBg : def.titleEn}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {fanRows.length > 0 && (
            <div className="h-[180px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={fanRows}
                  margin={{ top: 6, right: 8, left: 0, bottom: 0 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    opacity={0.15}
                  />
                  <XAxis
                    dataKey="quarter"
                    tick={{ fontSize: 9 }}
                    tickLine={false}
                    axisLine={false}
                    minTickGap={24}
                  />
                  <YAxis
                    tick={{ fontSize: 9 }}
                    tickLine={false}
                    axisLine={false}
                    width={40}
                    tickFormatter={(v: number) =>
                      formatMeasureValue(measure, v, i18n.language)
                    }
                  />
                  <Tooltip
                    formatter={(v: number | number[]) =>
                      Array.isArray(v)
                        ? v
                            .map((x) =>
                              formatMeasureValue(measure, x, i18n.language),
                            )
                            .join(" – ")
                        : formatMeasureValue(measure, v, i18n.language)
                    }
                    contentStyle={{ fontSize: 11 }}
                  />
                  {/* p10–p90 outer band. */}
                  <Area
                    dataKey="band9010"
                    stroke="none"
                    fill="rgb(13 148 136)"
                    fillOpacity={0.1}
                    isAnimationActive={false}
                  />
                  {/* p25–p75 inner band. */}
                  <Area
                    dataKey="band7525"
                    stroke="none"
                    fill="rgb(13 148 136)"
                    fillOpacity={0.18}
                    isAnimationActive={false}
                  />
                  {/* National median. */}
                  <Line
                    type="monotone"
                    dataKey="median"
                    stroke="rgb(148 163 184)"
                    strokeWidth={1.5}
                    strokeDasharray="4 4"
                    dot={false}
                    isAnimationActive={false}
                  />
                  {/* This hospital, threaded through the distribution. */}
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke="rgb(13 148 136)"
                    strokeWidth={2.5}
                    dot={{ r: 2 }}
                    connectNulls
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
          <p className="text-[10px] text-muted-foreground/80">
            {bg
              ? `Плътна линия: тази болница. Пунктир: националната медиана. Лентите: 10–90 и 25–75 персентил на всички болници (${nzokMeasure(measure)?.titleBg}). Източник: МЗ, единни електронни отчетни форми (ЕЕОФ), тримесечно.`
              : `Solid: this hospital. Dashed: the national median. Bands: the 10–90 and 25–75 percentiles of all hospitals (${nzokMeasure(measure)?.titleEn}). Source: МЗ standardized quarterly reporting forms (ЕЕОФ).`}
          </p>
        </div>

        {/* Reporting coverage — which quarters this hospital reported, so a gap in
            the fan above isn't misread as a real drop. */}
        {coverage.data &&
          coverage.data.presentCount < coverage.data.totalQuarters && (
            <div className="space-y-1 border-t pt-3">
              <div className="text-xs text-muted-foreground">
                {bg
                  ? `Отчетени тримесечия: ${coverage.data.presentCount} от ${coverage.data.totalQuarters} (от ${coverage.data.firstPresent}). Липсващо тримесечие е пропуск в отчитането, не спад.`
                  : `Quarters reported: ${coverage.data.presentCount} of ${coverage.data.totalQuarters} (since ${coverage.data.firstPresent}). A missing quarter is a reporting gap, not a drop.`}
              </div>
              <div className="flex flex-wrap gap-0.5" aria-hidden>
                {coverage.data.quarters.map((q) => (
                  <span
                    key={q.quarter}
                    title={q.quarter}
                    className={`h-2 w-2 rounded-sm ${
                      q.present ? "bg-teal-500/70" : "bg-muted-foreground/20"
                    }`}
                  />
                ))}
              </div>
            </div>
          )}
      </CardContent>
    </Card>
  );
};
