// Hero tile for the EU compare dashboard — World Bank WGI radar with BG
// overlaid against the visible peer set and the computed EU27 mean. Six
// axes (Voice & Accountability, Political Stability, Government
// Effectiveness, Regulatory Quality, Rule of Law, Control of Corruption)
// drawn at a fixed -1.5..+1.5 domain so the BG / peer / EU27 polygons
// stay visually distinguishable. The theoretical WGI range is -2.5..+2.5
// but values cluster between roughly -1 and +1.5 in practice; the wider
// domain would make the chart look flat.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import {
  useMacroPeers,
  WGI_DIMENSIONS,
  type PeerGeo,
  type WgiDimension,
} from "@/data/macro/useMacroPeers";
import { cn } from "@/lib/utils";
import { Flag } from "./Flag";
import {
  GEO_SHORT_BG,
  GEO_SHORT_EN,
  GEO_COLOR,
  usePeerSelection,
} from "./usePeerSelection";
import { pickByYear, useElectionYear } from "./useElectionYear";

// Short, localized labels for the six axes. Full names live in the
// explanatory copy below the chart.
const DIM_LABEL_KEYS: Record<WgiDimension, string> = {
  VA: "eu_compare_wgi_dim_va",
  PV: "eu_compare_wgi_dim_pv",
  GE: "eu_compare_wgi_dim_ge",
  RQ: "eu_compare_wgi_dim_rq",
  RL: "eu_compare_wgi_dim_rl",
  CC: "eu_compare_wgi_dim_cc",
};

type Row = { dim: string } & Partial<Record<PeerGeo, number>>;

// Custom tooltip — Recharts' default colours each row with the series stroke,
// which fails WCAG contrast for the yellow (RO) and navy (HR) flag tones in
// both themes. We use a small flag swatch as the country indicator and
// neutral foreground text for the values, sorted descending so the reader
// can spot BG's rank at a glance.
//
// Typed against the loose payload shape Recharts hands the `content` callback
// (rather than `TooltipProps<TValue, TName>`) so the parent can spread the
// callback's props through without a generic-mismatch error at build time.
type WgiTooltipProps = {
  active?: boolean;
  payload?: Array<{ dataKey?: string | number; value?: unknown }>;
  label?: string | number;
  shortLabel: Record<PeerGeo, string>;
};

const WgiTooltip = ({
  active,
  payload,
  label,
  shortLabel,
}: WgiTooltipProps) => {
  if (!active || !payload || payload.length === 0) return null;
  const rows = payload
    .filter((p) => typeof p.value === "number")
    .map((p) => ({
      geo: p.dataKey as PeerGeo,
      value: p.value as number,
    }))
    .sort((a, b) => b.value - a.value);
  return (
    <div className="rounded-md border border-border bg-background/95 px-2.5 py-2 text-[11px] shadow-sm backdrop-blur">
      <div className="mb-1.5 font-semibold text-foreground">{label}</div>
      <div className="flex flex-col gap-0.5">
        {rows.map(({ geo, value }) => {
          const isBg = geo === "BG";
          return (
            <div
              key={geo}
              className={cn(
                "flex items-center gap-2",
                isBg ? "font-semibold text-foreground" : "text-foreground/85",
              )}
            >
              <Flag geo={geo} size={10} title={shortLabel[geo]} />
              <span className="w-6">{shortLabel[geo]}</span>
              <span className="ml-auto tabular-nums">{value.toFixed(2)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const EuCompareWgiRadar: FC = () => {
  const { t, i18n } = useTranslation();
  const lang: "bg" | "en" = i18n.language === "bg" ? "bg" : "en";
  const { data: peers } = useMacroPeers();
  const { geos } = usePeerSelection();
  const electionYear = useElectionYear();
  const wgi = peers?.wgi;
  const shortLabel = lang === "bg" ? GEO_SHORT_BG : GEO_SHORT_EN;

  // Pick the WGI snapshot per (dim, geo) closest to (≤) the selected
  // election year. The resolved year may differ from electionYear when the
  // election is older than the WGI series or when a member state lags;
  // `resolvedYear` is the year actually rendered, surfaced below the chart.
  const data: Row[] = useMemo(() => {
    if (!wgi) return [];
    return WGI_DIMENSIONS.map((dim) => {
      const row: Row = { dim: t(DIM_LABEL_KEYS[dim]) };
      const perGeo = wgi.series[dim] ?? {};
      for (const g of geos) {
        const cell = pickByYear(perGeo[g], electionYear);
        if (cell != null) row[g] = cell.value;
      }
      return row;
    });
  }, [wgi, geos, t, electionYear]);

  // For the year label below the chart, take BG's resolved year on the
  // first dimension — all dimensions share the same publication schedule
  // so they resolve to the same year in practice.
  const resolvedYear = useMemo(() => {
    if (!wgi) return null;
    const firstDim = WGI_DIMENSIONS[0];
    const bgSeries = wgi.series[firstDim]?.BG;
    return pickByYear(bgSeries, electionYear)?.year ?? null;
  }, [wgi, electionYear]);

  if (!wgi || data.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("gov_macro_unavailable")}
      </p>
    );
  }

  // BG drawn last so its fill sits on top; EU27 drawn first as a muted
  // backdrop; peers in between.
  const drawOrder: PeerGeo[] = [
    "EU27_2020",
    ...geos.filter((g) => g !== "BG" && g !== "EU27_2020"),
    "BG",
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="h-[340px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          {/* outerRadius is intentionally tight (65%) so the long Cyrillic
              axis labels — "Антикорупция", "Ефективност", "Стабилност" —
              have headroom on narrow viewports without clipping. On wider
              viewports the chart still reads well because the container
              height (340px) caps the perceived radar size. */}
          <RadarChart data={data} outerRadius="65%">
            <PolarGrid stroke="hsl(var(--border))" />
            <PolarAngleAxis
              dataKey="dim"
              tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
            />
            <PolarRadiusAxis
              domain={[-1.5, 1.5]}
              tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
              tickCount={4}
              axisLine={false}
            />
            {drawOrder.map((geo) => {
              if (!geos.includes(geo)) return null;
              const isBg = geo === "BG";
              const isEu = geo === "EU27_2020";
              return (
                <Radar
                  key={geo}
                  name={shortLabel[geo]}
                  dataKey={geo}
                  stroke={GEO_COLOR[geo]}
                  strokeWidth={isBg ? 2.5 : isEu ? 1.5 : 1.5}
                  strokeDasharray={isEu ? "4 3" : undefined}
                  fill={GEO_COLOR[geo]}
                  fillOpacity={isBg ? 0.28 : 0}
                  isAnimationActive={false}
                />
              );
            })}
            <Tooltip
              cursor={{
                stroke: "hsl(var(--muted-foreground))",
                strokeWidth: 0.5,
                strokeDasharray: "2 3",
              }}
              content={(props) => (
                <WgiTooltip {...props} shortLabel={shortLabel} />
              )}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
        {geos.map((g) => (
          <span key={g} className="inline-flex items-center gap-1.5">
            <Flag geo={g} size={11} title={shortLabel[g]} />
            <span
              className={cn(
                g === "BG"
                  ? "font-semibold text-foreground"
                  : "text-muted-foreground",
              )}
            >
              {shortLabel[g]}
            </span>
          </span>
        ))}
        <span className="text-[10px] text-muted-foreground/70 ml-auto">
          {t("eu_compare_wgi_year", { year: resolvedYear ?? wgi.latestYear })}
        </span>
      </div>
    </div>
  );
};
