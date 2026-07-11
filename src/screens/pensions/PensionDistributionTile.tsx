// "Разпределение на пенсиите" — the flagship. Bulgaria's ~2.05M pensioners by
// monthly pension bracket, from chapter 5.1 of the НОИ yearbook. The point of
// the tile is the shape the average hides: a mountain piled against the statutory
// minimum and a wall at the таван (cap), with almost no one in the valley between
// — where the reported "average pension" sits and describes nobody.
//
// The bracket boundaries ARE the policy parameters (minimum pension, cap), so
// the histogram literally shows the law. We shade the sub-poverty region with the
// Eurostat at-risk-of-poverty threshold and mark the minimum + cap.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { BarChart3 } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Cell,
  ReferenceLine,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatInt } from "@/lib/currency";
import type { NoiPensionDistributionYear } from "@/data/budget/types";

interface HistBar {
  key: string;
  labelBg: string;
  labelEn: string;
  count: number;
  share: number;
  belowPoverty: boolean;
  atFloor: boolean;
}

/** A compact лв range label: "493–581", "до 276", "над 3400". */
const rangeLabel = (
  lo: number | null,
  hi: number | null,
): { bg: string; en: string } => {
  const r = (n: number) => Math.round(n);
  if (lo == null && hi != null) return { bg: `до ${r(hi)}`, en: `≤${r(hi)}` };
  if (hi == null && lo != null) return { bg: `над ${r(lo)}`, en: `>${r(lo)}` };
  if (lo != null && hi != null)
    return { bg: `${r(lo)}–${r(hi)}`, en: `${r(lo)}–${r(hi)}` };
  return { bg: "", en: "" };
};

const PensionTooltip: FC<{
  active?: boolean;
  payload?: { payload: HistBar }[];
  bg: boolean;
  lang: string;
}> = ({ active, payload, bg, lang }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
      <div className="font-medium tabular-nums">
        {bg ? d.labelBg : d.labelEn} лв
      </div>
      <div className="tabular-nums">
        {formatInt(d.count, lang)} {bg ? "пенсионери" : "pensioners"} ·{" "}
        {(d.share * 100).toLocaleString(lang, { maximumFractionDigits: 1 })}%
      </div>
    </div>
  );
};

export const PensionDistributionTile: FC<{
  data: NoiPensionDistributionYear;
}> = ({ data }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";

  const bars = useMemo<HistBar[]>(() => {
    const min = data.minPensionBgn;
    const pov = data.povertyLineBgn;
    return data.brackets.map((b) => {
      const rl = rangeLabel(b.lo, b.hi);
      // "at the floor" = a bracket whose whole range sits at or below the
      // statutory minimum pension.
      const atFloor = min != null && b.hi != null && b.hi <= min + 0.01;
      // "below poverty" = the bracket's upper edge is under the poverty line.
      const belowPoverty = pov != null && b.hi != null && b.hi <= pov;
      return {
        key: String(b.index),
        labelBg: rl.bg,
        labelEn: rl.en,
        count: b.count,
        share: b.share,
        belowPoverty,
        atFloor,
      };
    });
  }, [data]);

  // Headline reframe computed off the same brackets.
  const stats = useMemo(() => {
    const min = data.minPensionBgn;
    const atOrBelowMin = data.brackets
      .filter((b) => min != null && b.hi != null && b.hi <= min + 0.01)
      .reduce((s, b) => s + b.count, 0);
    return {
      atOrBelowMinShare: data.total > 0 ? atOrBelowMin / data.total : 0,
    } as const;
  }, [data]);

  // Poverty reference position — the ReferenceLine's `x` must equal the XAxis
  // category value, which is the bracket LABEL (not its index), so return the
  // label of the first bracket whose upper edge reaches the threshold.
  const refLabelAbove = (v: number | null): string | null => {
    if (v == null) return null;
    const b = data.brackets.find((x) => x.hi != null && x.hi >= v);
    if (!b) return null;
    const rl = rangeLabel(b.lo, b.hi);
    return bg ? rl.bg : rl.en;
  };
  const povKey = refLabelAbove(data.povertyLineBgn);

  const pct = (v: number) =>
    (v * 100).toLocaleString(lang, { maximumFractionDigits: 1 }) + "%";

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <BarChart3 className="h-4 w-4" />
          {bg
            ? `Разпределение на пенсиите (${data.year})`
            : `Distribution of pensions (${data.year})`}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-4">
        {/* The reframe that is the whole point */}
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <div>
            <span className="text-2xl font-bold tabular-nums">
              {pct(stats.atOrBelowMinShare)}
            </span>{" "}
            <span className="text-muted-foreground">
              {bg
                ? `получават минимална пенсия или по-малко${data.minPensionBgn != null ? ` (${data.minPensionBgn} лв)` : ""}`
                : `get the minimum pension or less${data.minPensionBgn != null ? ` (${data.minPensionBgn} лв)` : ""}`}
            </span>
          </div>
          {data.atCapCount != null && data.capBgn != null && (
            <div>
              <span className="text-2xl font-bold tabular-nums">
                {formatInt(data.atCapCount, lang)}
              </span>{" "}
              <span className="text-muted-foreground">
                {bg
                  ? `са точно на тавана (${data.capBgn} лв)`
                  : `sit exactly at the cap (${data.capBgn} лв)`}
              </span>
            </div>
          )}
        </div>

        <div className="h-[260px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={bars}
              margin={{ top: 8, right: 8, bottom: 28, left: 8 }}
            >
              <XAxis
                dataKey={bg ? "labelBg" : "labelEn"}
                tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                angle={-45}
                textAnchor="end"
                interval={0}
                height={40}
              />
              <YAxis
                domain={[0, "dataMax"]}
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                tickFormatter={(v: number) =>
                  v >= 1000 ? `${Math.round(v / 1000)}k` : String(v)
                }
                width={34}
              />
              <Tooltip
                content={<PensionTooltip bg={bg} lang={lang} />}
                cursor={{ fill: "hsl(var(--muted) / 0.4)" }}
              />
              {povKey && (
                <ReferenceLine
                  x={povKey}
                  stroke="hsl(var(--destructive))"
                  strokeDasharray="4 3"
                  label={{
                    value: bg ? "линия на бедност" : "poverty line",
                    position: "insideTopRight",
                    fontSize: 9,
                    fill: "hsl(var(--destructive))",
                  }}
                />
              )}
              <Bar
                dataKey="count"
                radius={[2, 2, 0, 0]}
                isAnimationActive={false}
              >
                {bars.map((b) => (
                  <Cell
                    key={b.key}
                    fill={
                      b.atFloor
                        ? "hsl(var(--primary))"
                        : b.belowPoverty
                          ? "hsl(var(--primary) / 0.55)"
                          : "hsl(var(--muted-foreground) / 0.45)"
                    }
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Legend — the three bar states are distinguished by colour, so name
            them for readers who can't rely on hue alone. */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
          <span className="inline-flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 rounded-sm"
              style={{ background: "hsl(var(--primary))" }}
            />
            <span className="text-muted-foreground">
              {bg ? "Минимална пенсия или по-малко" : "Minimum pension or less"}
            </span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 rounded-sm"
              style={{ background: "hsl(var(--primary) / 0.55)" }}
            />
            <span className="text-muted-foreground">
              {bg ? "Под линията на бедност" : "Below the poverty line"}
            </span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 rounded-sm"
              style={{ background: "hsl(var(--muted-foreground) / 0.45)" }}
            />
            <span className="text-muted-foreground">
              {bg ? "Над линията на бедност" : "Above the poverty line"}
            </span>
          </span>
        </div>

        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? `Средната пенсия описва малцина — разпределението е струпано при минимума и при тавана. Оцветените стълбове са под линията на бедност (${data.povertyLineBgn ?? "?"} лв/мес., Евростат). Източник: НОИ, статистически годишник (гл. 5).`
            : `The average pension describes almost no one — the distribution piles up at the minimum and at the cap. Shaded bars are below the poverty line (${data.povertyLineBgn ?? "?"} лв/mo, Eurostat). Source: НОИ statistical yearbook (ch. 5).`}
        </p>
      </CardContent>
    </Card>
  );
};
