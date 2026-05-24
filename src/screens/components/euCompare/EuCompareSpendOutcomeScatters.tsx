// Spend → outcome scatters — the cross-domain "is the spending paying off?"
// view that no Eurostat / OECD / OWID dashboard ships. Each scatter pairs a
// COFOG functional-spend axis (% GDP) with a SILC / demographics outcome
// for the same peer set. BG is drawn as a labelled coloured dot; peers
// muted; EU27 dashed reference lines on both axes.
//
// v1 ships two scatters where both axes already exist in the data pipeline:
//   1. Health spend (GF07) vs life expectancy at birth (Eurostat demo_mlexpec)
//   2. Social protection spend (GF10) vs AROPE (SILC ilc_peps01n)
// A third (education GF09 vs PISA score) ships once the curated PISA
// table is added in a follow-up — keeping that off the page rather than
// surfacing a hand-wave panel.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  CartesianGrid,
  Label,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useCofog, type CofogCode } from "@/data/macro/useCofog";
import {
  usePeerIndicatorAnnual,
  type PeerGeo,
} from "@/data/macro/useMacroPeers";
import { cn } from "@/lib/utils";
import { Flag } from "./Flag";
import {
  GEO_COLOR,
  GEO_SHORT_BG,
  GEO_SHORT_EN,
  usePeerSelection,
} from "./usePeerSelection";
import { pickByYear, useCompareSnapshotYear } from "./useElectionYear";

type FunctionCode = Exclude<CofogCode, "TOTAL">;

type ScatterPoint = {
  x: number;
  y: number;
  geo: PeerGeo;
  label: string;
  isBg: boolean;
};

const useScatterData = (
  spendCode: FunctionCode,
  outcomeKey: string,
  visibleGeos: PeerGeo[],
  shortLabel: Record<PeerGeo, string>,
  electionYear: number,
): {
  points: ScatterPoint[];
  euX: number | null;
  euY: number | null;
} => {
  const { data: cofog } = useCofog();
  const outcome = usePeerIndicatorAnnual(outcomeKey);
  return useMemo(() => {
    // Pick the COFOG composition year ≤ electionYear. Walk peerSeriesByYear
    // back from electionYear to find the latest year that has data.
    const byYear = cofog?.peerSeriesByYear ?? {};
    const years = Object.keys(byYear)
      .map((y) => Number(y))
      .filter((y) => Number.isFinite(y))
      .sort((a, b) => a - b);
    let resolvedYear: number | undefined;
    for (let i = years.length - 1; i >= 0; i--) {
      if (years[i] <= electionYear) {
        resolvedYear = years[i];
        break;
      }
    }
    if (resolvedYear == null) resolvedYear = years[0];
    const peerSeries =
      resolvedYear != null ? (byYear[String(resolvedYear)] ?? {}) : {};

    const points: ScatterPoint[] = [];
    let euX: number | null = null;
    let euY: number | null = null;
    for (const g of visibleGeos) {
      const x = peerSeries[g]?.[spendCode];
      const yPoint = pickByYear(outcome?.series[g], electionYear);
      const y = yPoint?.value;
      if (x == null || y == null) continue;
      const point: ScatterPoint = {
        x,
        y,
        geo: g,
        label: shortLabel[g],
        isBg: g === "BG",
      };
      points.push(point);
      if (g === "EU27_2020") {
        euX = x;
        euY = y;
      }
    }
    return { points, euX, euY };
  }, [cofog, outcome, visibleGeos, spendCode, shortLabel, electionYear]);
};

// Custom tooltip — Recharts' default labels rows as "x" and "y" which is
// useless for a non-developer reader. We pick the country off the hovered
// point's `geo` field and render flag + name + the two indicator names
// with their formatted values, so the tooltip teaches the reader what
// the axes mean while they hover.
//
// Typed against the loose payload shape Recharts hands the `content`
// callback (rather than `TooltipProps<TValue, TName>`) so the parent can
// spread the callback's props through without a generic-mismatch at build.
type ScatterTooltipProps = {
  active?: boolean;
  payload?: Array<{ payload?: ScatterPoint }>;
  xLabel: string;
  yLabel: string;
  xFormat: (v: number) => string;
  yFormat: (v: number) => string;
};

const ScatterTooltip = ({
  active,
  payload,
  xLabel,
  yLabel,
  xFormat,
  yFormat,
}: ScatterTooltipProps) => {
  if (!active || !payload || payload.length === 0) return null;
  // All series share the same point shape; the first non-null entry carries
  // the hovered country.
  const point = payload.find((p) => p.payload)?.payload as
    | ScatterPoint
    | undefined;
  if (!point) return null;
  return (
    <div className="rounded-md border border-border bg-background/95 px-2.5 py-2 text-[11px] shadow-sm backdrop-blur">
      <div
        className={cn(
          "mb-1.5 flex items-center gap-1.5",
          point.isBg ? "font-semibold text-foreground" : "text-foreground",
        )}
      >
        <Flag geo={point.geo} size={11} title={point.label} />
        <span>{point.label}</span>
      </div>
      <div className="flex flex-col gap-0.5 text-foreground/85">
        <div className="flex items-baseline gap-3">
          <span className="text-muted-foreground">{xLabel}</span>
          <span className="ml-auto tabular-nums">{xFormat(point.x)}</span>
        </div>
        <div className="flex items-baseline gap-3">
          <span className="text-muted-foreground">{yLabel}</span>
          <span className="ml-auto tabular-nums">{yFormat(point.y)}</span>
        </div>
      </div>
    </div>
  );
};

const MiniScatter: FC<{
  spendCode: FunctionCode;
  outcomeKey: string;
  titleKey: string;
  explainerKey: string;
  xLabelKey: string;
  yLabelKey: string;
  yFormat: (v: number) => string;
}> = ({
  spendCode,
  outcomeKey,
  titleKey,
  explainerKey,
  xLabelKey,
  yLabelKey,
  yFormat,
}) => {
  const { t, i18n } = useTranslation();
  const lang: "bg" | "en" = i18n.language === "bg" ? "bg" : "en";
  const { geos } = usePeerSelection();
  const electionYear = useCompareSnapshotYear();
  const shortLabel = lang === "bg" ? GEO_SHORT_BG : GEO_SHORT_EN;
  const { points, euX, euY } = useScatterData(
    spendCode,
    outcomeKey,
    geos,
    shortLabel,
    electionYear,
  );

  if (points.length < 3) {
    return (
      <div className="rounded border border-border/50 p-3">
        <h3 className="text-sm font-semibold mb-1">{t(titleKey)}</h3>
        <p className="text-xs text-muted-foreground">
          {t("gov_macro_unavailable")}
        </p>
      </div>
    );
  }

  // BG drawn last so its label sits on top of any near-overlapping peer.
  const drawOrder = [...points].sort((a, b) => (a.isBg ? 1 : b.isBg ? -1 : 0));

  // Pad the axes a bit so the labels aren't clipped at the edges.
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const xMin = Math.floor(Math.min(...xs) * 0.9 * 10) / 10;
  const xMax = Math.ceil(Math.max(...xs) * 1.1 * 10) / 10;
  const yMin = Math.floor(Math.min(...ys) * 0.99);
  const yMax = Math.ceil(Math.max(...ys) * 1.01);

  return (
    <div className="rounded border border-border/50 p-3">
      <h3 className="text-sm font-semibold mb-1">{t(titleKey)}</h3>
      <p className="text-[11px] text-muted-foreground mb-2">
        {t(explainerKey)}
      </p>
      <div className="h-[220px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 10, right: 12, bottom: 24, left: 12 }}>
            <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="2 3" />
            <XAxis
              type="number"
              dataKey="x"
              domain={[xMin, xMax]}
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              stroke="hsl(var(--border))"
            >
              <Label
                value={t(xLabelKey)}
                position="bottom"
                offset={-2}
                style={{
                  fontSize: 10,
                  fill: "hsl(var(--muted-foreground))",
                }}
              />
            </XAxis>
            <YAxis
              type="number"
              dataKey="y"
              domain={[yMin, yMax]}
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              stroke="hsl(var(--border))"
            >
              <Label
                value={t(yLabelKey)}
                angle={-90}
                position="insideLeft"
                style={{
                  fontSize: 10,
                  fill: "hsl(var(--muted-foreground))",
                  textAnchor: "middle",
                }}
              />
            </YAxis>
            {euX != null && (
              <ReferenceLine
                x={euX}
                stroke="hsl(var(--muted-foreground))"
                strokeDasharray="3 3"
                strokeWidth={0.8}
              />
            )}
            {euY != null && (
              <ReferenceLine
                y={euY}
                stroke="hsl(var(--muted-foreground))"
                strokeDasharray="3 3"
                strokeWidth={0.8}
              />
            )}
            <Tooltip
              cursor={false}
              content={(props) => (
                <ScatterTooltip
                  {...props}
                  xLabel={t(xLabelKey)}
                  yLabel={t(yLabelKey)}
                  xFormat={(v) => `${v.toFixed(1)}%`}
                  yFormat={yFormat}
                />
              )}
            />
            {drawOrder.map((p) => (
              <Scatter
                key={p.geo}
                data={[p]}
                fill={GEO_COLOR[p.geo]}
                shape="circle"
                isAnimationActive={false}
              >
                <LabelList
                  dataKey="label"
                  position="top"
                  style={{
                    fontSize: 10,
                    fill: p.isBg
                      ? "hsl(var(--foreground))"
                      : "hsl(var(--muted-foreground))",
                    fontWeight: p.isBg ? 600 : 400,
                  }}
                />
              </Scatter>
            ))}
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export const EuCompareSpendOutcomeScatters: FC = () => (
  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
    <MiniScatter
      spendCode="GF07"
      outcomeKey="lifeExpectancy"
      titleKey="eu_compare_scatter_health_title"
      explainerKey="eu_compare_scatter_health_explainer"
      xLabelKey="eu_compare_scatter_axis_health_spend"
      yLabelKey="eu_compare_scatter_axis_life_expectancy"
      yFormat={(v) => `${v.toFixed(1)} ${"yr"}`}
    />
    <MiniScatter
      spendCode="GF10"
      outcomeKey="arope"
      titleKey="eu_compare_scatter_social_title"
      explainerKey="eu_compare_scatter_social_explainer"
      xLabelKey="eu_compare_scatter_axis_social_spend"
      yLabelKey="eu_compare_scatter_axis_arope"
      yFormat={(v) => `${v.toFixed(1)}%`}
    />
  </div>
);
