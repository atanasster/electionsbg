// BG vs EU27 average + CEE peers (RO, HU, PL) — general government revenue,
// expenditure and balance as % of GDP, latest Eurostat annual figure with a
// 5-year sparkline. Data: data/macro_peers.json (gov_10a_main).

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Scale } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { cn } from "@/lib/utils";
import {
  useMacroPeers,
  type PeerGeo,
  type PeerMetric,
  type PeerPoint,
} from "@/data/macro/useMacroPeers";

// Peer roster matches macro_peers.json v2: BG anchors, EU27 as benchmark,
// RO + GR as geographic neighbors, HU + HR as CEE peers. PL was dropped in
// the v2 dataset in favor of HR.
const PEER_ORDER: PeerGeo[] = ["BG", "EU27_2020", "RO", "GR", "HU", "HR"];

const GEO_LABELS: Record<PeerGeo, { bg: string; en: string; code: string }> = {
  BG: { bg: "България", en: "Bulgaria", code: "BG" },
  EU27_2020: { bg: "ЕС-27", en: "EU-27", code: "EU" },
  RO: { bg: "Румъния", en: "Romania", code: "RO" },
  GR: { bg: "Гърция", en: "Greece", code: "GR" },
  HU: { bg: "Унгария", en: "Hungary", code: "HU" },
  HR: { bg: "Хърватия", en: "Croatia", code: "HR" },
};

const METRIC_INFO: Record<
  PeerMetric,
  {
    titleKey: string;
    titleFallback: string;
    tone: "revenue" | "expense" | "balance";
  }
> = {
  TR: {
    titleKey: "budget_peers_revenue",
    titleFallback: "Revenue (% GDP)",
    tone: "revenue",
  },
  TE: {
    titleKey: "budget_peers_expenditure",
    titleFallback: "Expenditure (% GDP)",
    tone: "expense",
  },
  B9: {
    titleKey: "budget_peers_balance",
    titleFallback: "Balance (% GDP)",
    tone: "balance",
  },
};

// Tiny inline sparkline. Renders a polyline across the last n points; range
// auto-fits per geo so a flat -2% trend is visually distinct from a -7% one.
const Sparkline: FC<{
  points: PeerPoint[];
  width?: number;
  height?: number;
  stroke?: string;
}> = ({ points, width = 56, height = 16, stroke = "currentColor" }) => {
  if (points.length < 2) return <span className="inline-block w-14" />;
  const ys = points.map((p) => p.value);
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  const span = max - min || 1;
  const path = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * (width - 2) + 1;
      const y = height - 1 - ((p.value - min) / span) * (height - 2);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="shrink-0 opacity-70"
      aria-hidden
    >
      <path d={path} fill="none" stroke={stroke} strokeWidth="1.2" />
    </svg>
  );
};

interface MetricRow {
  geo: PeerGeo;
  value: number;
  trend: PeerPoint[];
}

interface MetricBlock {
  metric: PeerMetric;
  rows: MetricRow[];
  latestYear: number;
  euAverage: number | null;
}

export const BudgetPeerComparisonTile: FC = () => {
  const { t, i18n } = useTranslation();
  const lang: "bg" | "en" = i18n.language === "bg" ? "bg" : "en";
  const { data: peers } = useMacroPeers();

  const blocks: MetricBlock[] = useMemo(() => {
    if (!peers) return [];
    const out: MetricBlock[] = [];
    for (const metric of peers.naItems) {
      // Establish a common latest year across geos for this metric — take the
      // earliest "latest" so every row is from the same year and comparable.
      const latestPerGeo = PEER_ORDER.map(
        (g) => peers.series[g]?.[metric]?.slice(-1)[0]?.year ?? -Infinity,
      );
      const latestYear = Math.min(...latestPerGeo);
      if (!Number.isFinite(latestYear)) continue;

      const rows: MetricRow[] = [];
      for (const geo of PEER_ORDER) {
        const series = peers.series[geo]?.[metric] ?? [];
        const point = series.find((p) => p.year === latestYear);
        if (!point) continue;
        const trend = series.filter((p) => p.year >= latestYear - 5).slice(-6);
        rows.push({ geo, value: point.value, trend });
      }
      const euRow = rows.find((r) => r.geo === "EU27_2020");
      out.push({
        metric,
        rows,
        latestYear,
        euAverage: euRow?.value ?? null,
      });
    }
    return out;
  }, [peers]);

  if (blocks.length === 0) return null;

  const fmtPct = (v: number) => `${v >= 0 ? "" : ""}${v.toFixed(1)}%`;
  const latestYearOverall = Math.max(...blocks.map((b) => b.latestYear));

  return (
    <Card className="my-4" data-og="budget-peer-comparison">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Scale className="h-4 w-4" />
          {t("budget_peers_title") || "Bulgaria vs EU peers"}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {(t("budget_peers_subtitle") ||
            "General-government revenue, expenditure and balance as % of GDP. Latest annual Eurostat figure, with a 6-year sparkline.") +
            ` · ${latestYearOverall}`}
        </p>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="grid gap-4 grid-cols-1 md:grid-cols-3">
          {blocks.map((block) => {
            const title =
              t(METRIC_INFO[block.metric].titleKey) ||
              METRIC_INFO[block.metric].titleFallback;
            // Pre-compute relative axis scale per block so the row indicator
            // width uses the same denominator across rows in the column.
            const absMax = Math.max(
              ...block.rows.map((r) => Math.abs(r.value)),
            );
            return (
              <div key={block.metric}>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                  {title}
                </div>
                <ul className="space-y-1.5">
                  {block.rows.map((row) => {
                    const isBg = row.geo === "BG";
                    const label = GEO_LABELS[row.geo][lang];
                    const code = GEO_LABELS[row.geo].code;
                    const tone = METRIC_INFO[block.metric].tone;
                    const isDeficit = block.metric === "B9" && row.value < 0;
                    const isOverMaastricht =
                      isDeficit && Math.abs(row.value) > 3;
                    const valueClass =
                      block.metric === "B9"
                        ? row.value < 0
                          ? isOverMaastricht
                            ? "text-rose-700 dark:text-rose-400"
                            : "text-rose-600/80 dark:text-rose-400/80"
                          : "text-emerald-700 dark:text-emerald-400"
                        : tone === "revenue"
                          ? "text-emerald-700 dark:text-emerald-400"
                          : "text-rose-700 dark:text-rose-400";
                    const barWidth =
                      absMax > 0 ? (Math.abs(row.value) / absMax) * 100 : 0;
                    const barColor =
                      block.metric === "B9"
                        ? row.value < 0
                          ? "bg-rose-400/60"
                          : "bg-emerald-400/60"
                        : tone === "revenue"
                          ? "bg-emerald-400/60"
                          : "bg-rose-400/60";
                    return (
                      <li
                        key={row.geo}
                        className={cn(
                          "text-xs rounded-md px-1.5 py-1",
                          isBg && "bg-primary/5 ring-1 ring-primary/20",
                        )}
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <span
                            className={cn(
                              "flex items-center gap-1.5 truncate",
                              isBg && "font-semibold",
                            )}
                            title={label}
                          >
                            <span
                              aria-hidden
                              className="inline-block w-7 text-center text-[10px] font-semibold tracking-wide text-muted-foreground border border-border rounded px-1"
                            >
                              {code}
                            </span>
                            <span className="truncate">{label}</span>
                          </span>
                          <span
                            className={cn(
                              "tabular-nums font-semibold shrink-0",
                              valueClass,
                            )}
                          >
                            {fmtPct(row.value)}
                          </span>
                        </div>
                        <div className="mt-0.5 flex items-center gap-2">
                          <div className="flex-1 h-1.5 rounded-full bg-muted/40 overflow-hidden">
                            <div
                              className={cn("h-full", barColor)}
                              style={{ width: `${barWidth}%` }}
                            />
                          </div>
                          <Sparkline
                            points={row.trend}
                            stroke={isBg ? "currentColor" : "currentColor"}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {block.metric === "B9" ? (
                  <p className="mt-2 text-[10px] text-muted-foreground">
                    {t("budget_peers_maastricht_hint") ||
                      "Dashed line at -3% = Maastricht ceiling."}
                  </p>
                ) : block.euAverage != null ? (
                  <p className="mt-2 text-[10px] text-muted-foreground tabular-nums">
                    {(t("budget_peers_eu_avg") || "EU-27 average") +
                      `: ${block.euAverage.toFixed(1)}%`}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-[10px] text-muted-foreground">
          {t("budget_peers_source") ||
            "Source: Eurostat gov_10a_main (annual general government main aggregates, sector S13, % of GDP)."}
        </p>
      </CardContent>
    </Card>
  );
};
