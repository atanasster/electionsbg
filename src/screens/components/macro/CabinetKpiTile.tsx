// Term-bounded KPI tile for /governments/:slug. Shares the visual shape of
// the landing-page KpiTile (square card with title + headline + sparkline +
// footer) but the headline is "term-start → term-end" with a signed delta,
// and the sparkline window is anchored to the cabinet's tenure rather than
// the trailing N years from "today".
//
// Caretaker cabinets and very short tenures (sub-2 data-points) fall back to
// "—" headlines via the same MIN_POINTS_FOR_AVG guard used by
// cabinetMetricsFor, so a 30-day Bliznashki caretaker doesn't claim it moved
// inflation by 0.1 pp.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useGovernments,
  type Government,
} from "@/data/governments/useGovernments";
import { useMacro, type MacroIndicatorKey } from "@/data/macro/useMacro";
import { pickAtOrBefore, type AsOf } from "@/data/macro/kpiSelectors";
import { KPI_REGISTRY } from "@/screens/indicators/indicatorsRegistry";
import { KpiSparkline } from "./KpiSparkline";

type Props = {
  indicatorKey: MacroIndicatorKey;
  government: Government;
  className?: string;
};

// Convert a cabinet's start/end dates into the snapshot anchors used by
// pickAtOrBefore. Start uses the quarter the cabinet was sworn in, end uses
// the quarter it left office (or current quarter for an incumbent).
const cabinetWindowAnchors = (
  g: Government,
): { startAnchor: AsOf; endAnchor: AsOf } => {
  const start = new Date(g.startDate);
  const end = g.endDate ? new Date(g.endDate) : new Date();
  const startAnchor: AsOf = {
    year: start.getUTCFullYear(),
    quarter: (Math.floor(start.getUTCMonth() / 3) + 1) as 1 | 2 | 3 | 4,
  };
  const endAnchor: AsOf = {
    year: end.getUTCFullYear(),
    quarter: (Math.floor(end.getUTCMonth() / 3) + 1) as 1 | 2 | 3 | 4,
  };
  return { startAnchor, endAnchor };
};

const formatDeltaPp = (delta: number): string => {
  const sign = delta >= 0 ? "+" : "";
  return `${sign}${delta.toFixed(1)} pp`;
};

export const CabinetKpiTile: FC<Props> = ({
  indicatorKey,
  government,
  className,
}) => {
  const { i18n, t } = useTranslation();
  const lang: "bg" | "en" = i18n.language === "bg" ? "bg" : "en";
  const { data: macro } = useMacro();
  const { data: governments } = useGovernments();
  const entry = KPI_REGISTRY[indicatorKey];

  const series = macro?.series[indicatorKey];

  const { startPoint, endPoint, windowPoints } = useMemo(() => {
    if (!series) {
      return { startPoint: null, endPoint: null, windowPoints: [] };
    }
    const { startAnchor, endAnchor } = cabinetWindowAnchors(government);
    const start = pickAtOrBefore(series, startAnchor);
    const end = pickAtOrBefore(series, endAnchor);
    // Window: every point with start.year ≤ p.year ≤ end.year (annual) or
    // bounded by quarter at the edges (quarterly). Keeps the sparkline tied
    // to the term rather than a sliding trailing window.
    const startMs = startAnchor.year * 4 + (startAnchor.quarter - 1);
    const endMs = endAnchor.year * 4 + (endAnchor.quarter - 1);
    const window = series.filter((p) => {
      const pms = p.year * 4 + ((p.quarter ?? 1) - 1);
      return pms >= startMs && pms <= endMs;
    });
    return { startPoint: start, endPoint: end, windowPoints: window };
  }, [series, government]);

  if (!entry || !macro || !endPoint) {
    return (
      <div
        className={cn(
          "rounded-xl border bg-card p-4 shadow-sm h-[180px] animate-pulse",
          className,
        )}
      />
    );
  }

  const meta = macro.indicators[indicatorKey];
  if (!meta) return null;

  const title = lang === "bg" ? meta.titleBg : meta.titleEn;
  const headline = startPoint
    ? `${entry.format(startPoint.value)} → ${entry.format(endPoint.value)}`
    : entry.format(endPoint.value);
  const delta = startPoint ? endPoint.value - startPoint.value : null;
  const deltaText =
    delta == null
      ? null
      : entry.formatDelta
        ? `${delta >= 0 ? "+" : ""}${entry.formatDelta(delta)}`
        : entry.deltaSuffix === "pp"
          ? formatDeltaPp(delta)
          : `${delta >= 0 ? "+" : ""}${delta.toFixed(
              entry.deltaDecimals ?? 1,
            )}${entry.deltaSuffix}`;

  // Sign vs direction → tone. "lower is better" + negative delta = good.
  const tone: "good" | "concern" | "neutral" =
    delta == null || entry.direction === "none"
      ? "neutral"
      : delta < 0 === (entry.direction === "lower")
        ? "good"
        : "concern";

  return (
    <div
      className={cn(
        "group relative flex h-full flex-col gap-2 rounded-xl border bg-card p-4 shadow-sm",
        className,
      )}
      id={`kpi-${indicatorKey}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {title}
        </div>
        <ArrowUpRight
          className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0"
          aria-hidden
        />
      </div>

      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="text-lg font-bold tabular-nums">{headline}</span>
        {deltaText ? (
          <span
            className={cn(
              "text-xs tabular-nums",
              tone === "good"
                ? "text-emerald-600 dark:text-emerald-400"
                : tone === "concern"
                  ? "text-rose-600 dark:text-rose-400"
                  : "text-muted-foreground",
            )}
          >
            {deltaText}
          </span>
        ) : null}
      </div>

      {windowPoints.length >= 3 ? (
        <div className="mt-auto pt-1" style={{ color: "var(--foreground)" }}>
          <KpiSparkline
            points={windowPoints}
            governments={governments ?? []}
            ariaLabel={`${title} sparkline`}
          />
        </div>
      ) : (
        <div className="mt-auto h-7" />
      )}

      <div className="text-[10px] text-muted-foreground tabular-nums">
        {t("cabinet_detail_kpi_during_term")}
      </div>
    </div>
  );
};
