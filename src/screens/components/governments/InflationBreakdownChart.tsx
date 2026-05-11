import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Area,
  ComposedChart,
  CartesianGrid,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Government } from "@/data/governments/useGovernments";
import {
  MacroIndicatorKey,
  MacroPayload,
  labelForFractionalX,
  pointToFractionalX,
} from "@/data/macro/useMacro";
import { tooltipSurfaceClass } from "@/components/ui/tooltipSurface";
import { cn } from "@/lib/utils";
import {
  toFractionalYear,
  xDomainFor,
} from "@/screens/components/governments/governmentTimelineUtils";
import { useChartInsets } from "@/screens/components/governments/governmentChartInsets";

// Same election anchors as GovernmentTimeline so all charts on /governments
// share the dashed-line overlay.
const ELECTION_DATES = [
  "2005_06_25",
  "2009_07_05",
  "2013_05_12",
  "2014_10_05",
  "2017_03_26",
  "2021_04_04",
  "2021_07_11",
  "2021_11_14",
  "2022_10_02",
  "2023_04_02",
  "2024_06_09",
  "2024_10_27",
  "2026_04_19",
];

const isoFromElectionKey = (key: string) => key.replace(/_/g, "-");

// Stack order: components rendered from bottom to top in this sequence.
// Energy first so the 2022 spike anchors the bottom of the stack — visually
// it's the dominant contributor that year and reads naturally as the base.
const COMPONENTS: MacroIndicatorKey[] = [
  "inflationEnergy",
  "inflationFood",
  "inflationServices",
  "inflationCore",
];

// Pulled into the same chart so the reader can compare the stacked sum (which
// is the simple sum of YoY rates, not basket-weighted) against the actual
// headline HICP rate. The gap is the basket-weighting error.
const HEADLINE_KEY: MacroIndicatorKey = "inflation";

const COMPONENT_COLORS: Record<string, string> = {
  inflationEnergy: "#dc2626",
  inflationFood: "#f59e0b",
  inflationServices: "#3b82f6",
  inflationCore: "#10b981",
};

type ChartRow = { x: number } & Partial<Record<MacroIndicatorKey, number>>;

const buildRows = (macro: MacroPayload | undefined): ChartRow[] => {
  if (!macro) return [];
  const byX = new Map<number, ChartRow>();
  for (const k of [...COMPONENTS, HEADLINE_KEY]) {
    for (const p of macro.series[k] ?? []) {
      const x = pointToFractionalX(p);
      const row = byX.get(x) ?? { x };
      row[k] = p.value;
      byX.set(x, row);
    }
  }
  return [...byX.values()].sort((a, b) => a.x - b.x);
};

const TooltipContent: FC<{
  active?: boolean;
  payload?: { value: number; dataKey: string; color: string }[];
  label?: number;
  governments: Government[];
  lang: "en" | "bg";
  indicatorTitles: MacroPayload["indicators"];
  caretakerLabel: string;
  regularLabel: string;
}> = ({
  active,
  payload,
  label,
  governments,
  lang,
  indicatorTitles,
  caretakerLabel,
  regularLabel,
}) => {
  if (!active || label === undefined) return null;
  const t = label;
  const matching = governments.filter((g) => {
    const s = toFractionalYear(g.startDate);
    const e = g.endDate ? toFractionalYear(g.endDate) : 9999;
    return s <= t && e >= t;
  });
  return (
    <div className={cn(tooltipSurfaceClass, "px-3 py-2 text-xs max-w-xs")}>
      <div className="font-semibold mb-1">{labelForFractionalX(label)}</div>
      {matching.map((g) => (
        <div key={g.id} className="mb-0.5">
          <span className="font-semibold">
            {lang === "bg" ? g.pmBg : g.pmEn}
          </span>
          <span className="ml-1 text-muted-foreground">
            ({g.type === "caretaker" ? caretakerLabel : regularLabel})
          </span>
        </div>
      ))}
      <div className="mt-1 border-t border-border pt-1 flex flex-col gap-0.5">
        {payload?.map((p) => {
          const meta = indicatorTitles[p.dataKey as MacroIndicatorKey];
          if (!meta) return null;
          return (
            <div key={p.dataKey} className="flex justify-between gap-2">
              <span style={{ color: p.color }}>
                {lang === "bg" ? meta.titleBg : meta.titleEn}
              </span>
              <span className="font-semibold tabular-nums">
                {typeof p.value === "number" ? `${p.value.toFixed(1)}%` : "—"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const InflationBreakdownChart: FC<{
  governments: Government[];
  macro: MacroPayload | undefined;
  height?: number;
}> = ({ governments, macro, height = 320 }) => {
  const { t, i18n } = useTranslation();
  const lang: "en" | "bg" = i18n.language === "bg" ? "bg" : "en";
  const insets = useChartInsets();

  const rows = useMemo(() => buildRows(macro), [macro]);
  const xDomain = useMemo<[number, number]>(
    () => xDomainFor(governments),
    [governments],
  );

  if (!macro || rows.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">
        {t("gov_macro_unavailable")}
      </div>
    );
  }

  return (
    <div className="w-full">
      {/* Component legend rendered as static chips — these are not toggles;
          the stacked-area story is the point and hiding a layer would break
          the comparison. Final chip is the headline HICP line overlay. */}
      <div className="flex flex-wrap gap-2 mb-3 text-xs">
        {COMPONENTS.map((k) => {
          const meta = macro.indicators[k];
          if (!meta) return null;
          return (
            <span
              key={k}
              className="px-3 py-1 rounded-full border-transparent text-white"
              style={{ backgroundColor: COMPONENT_COLORS[k] }}
            >
              {lang === "bg" ? meta.titleBg : meta.titleEn}
            </span>
          );
        })}
        <span
          className="px-3 py-1 rounded-full border-transparent text-white"
          style={{ backgroundColor: "#111827" }}
        >
          {lang === "bg" ? "ХИПЦ обща" : "Headline HICP"}
        </span>
      </div>

      <div className="w-full" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={rows}
            stackOffset="sign"
            margin={{
              top: 8,
              right: insets.marginRight,
              left: insets.marginLeft,
              bottom: 24,
            }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              vertical={false}
              opacity={0.2}
            />
            <XAxis
              dataKey="x"
              type="number"
              domain={xDomain}
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
              ticks={Array.from(
                { length: Math.ceil(xDomain[1]) - Math.floor(xDomain[0]) + 1 },
                (_, i) => Math.floor(xDomain[0]) + i,
              )}
            />
            <YAxis
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={insets.yAxisWidth}
              tickFormatter={(v) => `${v}%`}
            />
            <Tooltip
              content={
                <TooltipContent
                  governments={governments}
                  lang={lang}
                  indicatorTitles={macro.indicators}
                  caretakerLabel={t("gov_type_caretaker")}
                  regularLabel={t("gov_type_regular")}
                />
              }
            />

            {ELECTION_DATES.map((key) => {
              const x = toFractionalYear(isoFromElectionKey(key));
              return (
                <ReferenceLine
                  key={`elec-${key}`}
                  x={x}
                  stroke="#64748b"
                  strokeDasharray="3 3"
                  strokeOpacity={0.5}
                />
              );
            })}

            <ReferenceLine y={0} stroke="#64748b" strokeOpacity={0.4} />

            {COMPONENTS.map((k) => (
              <Area
                key={k}
                type="monotone"
                dataKey={k}
                stackId="hicp"
                stroke={COMPONENT_COLORS[k]}
                fill={COMPONENT_COLORS[k]}
                fillOpacity={0.7}
                isAnimationActive={false}
              />
            ))}

            {/* Headline HICP overlay — basket-weighted, so almost always
                below the stacked sum. The gap is the visual reminder that
                the stack is an unweighted sum of YoY rates. */}
            <Line
              type="monotone"
              dataKey={HEADLINE_KEY}
              stroke="#111827"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
              connectNulls
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
