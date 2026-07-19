// Shared BG-vs-EU(-vs-peers) price trend chart for the /consumption price pages
// (fuel, electricity). One metric per chart: BG bold, the EU average dashed as the
// benchmark, and the four neighbour peers (RO/GR/HU/HR) as thin coloured lines,
// each with its flag in the legend + tooltip. Extracted so fuel & electricity
// share the axis/tick/tooltip/cabinet-strip plumbing instead of duplicating it.

/* eslint-disable react-refresh/only-export-components -- this shared module
   deliberately co-locates the chart component with its small helpers
   (geoLabel / usePriceYearTicks / gapVsEu); it is not a fast-refresh boundary. */
import { FC, useMemo } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import type { PeerGeo } from "@/data/macro/useMacroPeers";
import {
  GEO_COLOR,
  PEER_LABELS_BG,
  PEER_LABELS_EN,
} from "@/screens/components/euCompare/usePeerSelection";
import { Flag } from "@/screens/components/euCompare/Flag";
import { useMediaQueryMatch } from "@/ux/useMediaQueryMatch";
import { ChartCabinetStrip } from "@/screens/components/governments/ChartCabinetStrip";
import { fmtPct, priceChangeColor } from "@/data/prices/usePrices";
import { tooltipSurfaceClass } from "@/components/ui/tooltipSurface";
import { cn } from "@/lib/utils";

// One chart row: an x category (a week date or a half-year period), the `date`
// the cabinet strip anchors to, and one value per geo.
export type PriceRow = { x: string; date: string } & Partial<
  Record<PeerGeo, number | null>
>;

export const geoLabel = (geo: PeerGeo, lang: "bg" | "en"): string => {
  if (geo === "BG") return lang === "bg" ? "България" : "Bulgaria";
  if (geo === "EU27_2020") return lang === "bg" ? "ЕС (средно)" : "EU average";
  return lang === "bg" ? PEER_LABELS_BG[geo] : PEER_LABELS_EN[geo];
};

// Year ticks = the first row of each year, thinned to ~7 labels on phones (a long
// history crowds even year labels at chart width).
export const usePriceYearTicks = (rows: PriceRow[]): string[] => {
  const isSmall = useMediaQueryMatch("sm");
  return useMemo(() => {
    const seen = new Set<string>();
    const firstOfYear: string[] = [];
    for (const r of rows) {
      const y = r.x.slice(0, 4);
      if (!seen.has(y)) {
        seen.add(y);
        firstOfYear.push(r.x);
      }
    }
    const maxLabels = isSmall ? 7 : 16;
    const step = Math.max(1, Math.ceil(firstOfYear.length / maxLabels));
    return firstOfYear.filter((_, i) => i % step === 0);
  }, [rows, isSmall]);
};

// BG anchors bold; EU is the dashed benchmark; peers are thin + faded so they read
// as context, never competing with the BG line.
const lineStyle = (geo: PeerGeo) => {
  if (geo === "BG")
    return { width: 2.6, dash: undefined as string | undefined, opacity: 1 };
  if (geo === "EU27_2020") return { width: 2, dash: "5 3", opacity: 0.9 };
  return { width: 1.4, dash: undefined, opacity: 0.7 };
};

/** Signed BG-vs-EU gap fraction (negative = BG cheaper); null if either side is
 *  missing. Shared by both pages' KPI tiles. */
export const gapVsEu = (
  bg: number | null | undefined,
  eu: number | null | undefined,
): number | null => (bg != null && eu != null && eu !== 0 ? bg / eu - 1 : null);

// KPI tile: a muted label, a big price, and the coloured gap-vs-EU line.
export const PriceStat: FC<{
  label: string;
  valueText: string | null;
  gap: number | null;
  lang: "bg" | "en";
}> = ({ label, valueText, gap, lang }) => (
  <div>
    <div className="text-xs text-muted-foreground">{label}</div>
    <div className="text-3xl font-bold tabular-nums">{valueText ?? "—"}</div>
    {gap != null ? (
      <div className={`text-xs tabular-nums ${priceChangeColor(gap)}`}>
        {fmtPct(gap)} {lang === "bg" ? "спрямо ЕС" : "vs the EU"}
      </div>
    ) : null}
  </div>
);

const PriceLegend: FC<{
  geos: PeerGeo[];
  lang: "bg" | "en";
  padLeft: number;
}> = ({ geos, lang, padLeft }) => (
  <div
    className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-2 text-[11px]"
    style={{ paddingLeft: padLeft }}
  >
    {geos.map((geo) => (
      <span
        key={geo}
        className="inline-flex items-center gap-1 text-muted-foreground"
      >
        <Flag geo={geo} size={11} />
        {geoLabel(geo, lang)}
      </span>
    ))}
  </div>
);

interface Props {
  rows: PriceRow[];
  /** Draw + legend order; BG and EU27_2020 first, then peers. */
  geos: PeerGeo[];
  lang: "bg" | "en";
  /** Formats a value for the tooltip (e.g. "€1.46/L", "€0.135/kWh"). */
  formatValue: (v: number) => string;
  /** Formats a y-axis tick. */
  formatY: (v: number) => string;
  yWidth?: number;
  /** Render the governments strip under the chart (skip on stacked charts that
   *  share one x-axis so the strip shows only once). */
  showCabinet?: boolean;
}

export const PriceTrendChart: FC<Props> = ({
  rows,
  geos,
  lang,
  formatValue,
  formatY,
  yWidth = 44,
  showCabinet = true,
}) => {
  const ticks = usePriceYearTicks(rows);
  const padLeft = yWidth + 4;
  if (!rows.length) return null;

  const Tip: FC<{
    active?: boolean;
    label?: string;
    payload?: Array<{ dataKey: string; value: number }>;
  }> = ({ active, label, payload }) => {
    if (!active || !payload?.length) return null;
    const sorted = [...payload]
      .filter((p) => p.value != null)
      .sort((a, b) => b.value - a.value);
    return (
      <div className={cn(tooltipSurfaceClass, "space-y-1 px-2 py-1.5 text-xs")}>
        <div className="font-semibold">{label}</div>
        {sorted.map((p) => (
          <div
            key={p.dataKey}
            className="flex items-center gap-1.5 tabular-nums"
          >
            <Flag geo={p.dataKey as PeerGeo} size={11} />
            <span className="text-muted-foreground">
              {geoLabel(p.dataKey as PeerGeo, lang)}
            </span>
            <span className="ml-auto font-medium">{formatValue(p.value)}</span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={rows}
            margin={{ top: 8, right: 8, left: 4, bottom: 4 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              vertical={false}
              opacity={0.2}
            />
            <XAxis
              dataKey="x"
              ticks={ticks}
              tickFormatter={(v: string) => v.slice(0, 4)}
              tick={{ fontSize: 10 }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              tick={{ fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              width={yWidth}
              domain={["auto", "auto"]}
              tickFormatter={formatY}
            />
            <Tooltip content={<Tip />} cursor={{ stroke: "var(--border)" }} />
            {geos.map((geo) => {
              const s = lineStyle(geo);
              return (
                <Line
                  key={geo}
                  type="monotone"
                  dataKey={geo}
                  stroke={GEO_COLOR[geo]}
                  strokeWidth={s.width}
                  strokeDasharray={s.dash}
                  strokeOpacity={s.opacity}
                  dot={false}
                  isAnimationActive={false}
                  connectNulls
                />
              );
            })}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <PriceLegend geos={geos} lang={lang} padLeft={padLeft} />

      {showCabinet ? (
        <div className="pt-1">
          <div
            className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground"
            style={{ paddingLeft: padLeft }}
          >
            {lang === "bg" ? "Правителства" : "Governments"}
          </div>
          <ChartCabinetStrip
            fromDate={rows[0].date}
            toDate={rows[rows.length - 1].date}
            padLeft={padLeft}
            padRight={8}
          />
        </div>
      ) : null}
    </>
  );
};
