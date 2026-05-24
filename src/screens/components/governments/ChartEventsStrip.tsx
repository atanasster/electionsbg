// Compact event strip rendered immediately below the GovernmentTimeline
// chart. Aligns to the same x-axis via the shared ChartInsets so a band
// labelled "COVID-19 2020–2022" sits directly under the 2020–2022 stretch
// of the macro chart. Three rows — one per ChartEventCategory — so events
// in different categories don't overlap visually.
//
// Bands (events with a start + end) render as translucent rectangles with
// a short label inside when there's room. Point events (start only) render
// as a thin vertical line with a small dot above the row. Hover surfaces
// the full description via the shared UxTooltip.
//
// A small horizontal legend below the rows decodes the category colors —
// without it the bands read as "decorative shapes" rather than "events".

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Tooltip as UxTooltip } from "@/ux/Tooltip";
import { tooltipSurfaceClass } from "@/components/ui/tooltipSurface";
import { useMediaQueryMatch } from "@/ux/useMediaQueryMatch";
import { useChartInsets } from "./governmentChartInsets";
import {
  EVENT_CATEGORY_COLOR,
  useChartEventCategoryLabels,
  type ChartEvent,
  type ChartEventCategory,
} from "./chartEvents";

// Convert an ISO date to a fractional year (mid-day precision is enough
// for visual placement on a 21-year axis).
const toFractional = (iso: string): number => {
  const d = new Date(iso);
  const y = d.getUTCFullYear();
  const start = Date.UTC(y, 0, 1);
  const end = Date.UTC(y + 1, 0, 1);
  return y + (d.getTime() - start) / (end - start);
};

const ROW_HEIGHT = 14; // px per category lane

const ROW_ORDER: ChartEventCategory[] = ["crisis", "pandemic", "protest"];

const EventBand: FC<{
  event: ChartEvent;
  startPct: number;
  widthPct: number;
  color: string;
  label: string;
  description: string;
  /** When true, hide the inline label even if the band is wide enough.
   *  Used on mobile where the chart is too narrow to fit any meaningful
   *  text — truncated labels like "Г.." or "Д" read as visual noise. */
  hideLabel?: boolean;
}> = ({ startPct, widthPct, color, label, description, hideLabel }) => {
  // Show inline label only when there's space for it (≥ ~5% of the strip
  // width fits ~8 characters at the 9px font size). Otherwise the band
  // reads as a colored stripe and the tooltip carries the name.
  // Threshold raised from 3.5 → 5 after mobile testing showed
  // single-letter truncations like "Д" or "СО..." that hurt more than
  // they helped.
  const showInlineLabel = !hideLabel && widthPct >= 5;
  return (
    <UxTooltip
      content={
        <div className="text-xs max-w-xs">
          <div className="font-semibold">{label}</div>
          <div className="text-muted-foreground mt-0.5">{description}</div>
        </div>
      }
    >
      <div
        className="absolute top-0 bottom-0 cursor-help rounded-sm flex items-center px-1 overflow-hidden text-[9px] font-medium text-white"
        style={{
          left: `${startPct}%`,
          width: `${widthPct}%`,
          backgroundColor: color,
          opacity: 0.7,
        }}
      >
        {showInlineLabel ? (
          <span className="truncate leading-none">{label}</span>
        ) : null}
      </div>
    </UxTooltip>
  );
};

const EventPoint: FC<{
  event: ChartEvent;
  positionPct: number;
  color: string;
  label: string;
  description: string;
}> = ({ positionPct, color, label, description }) => (
  <UxTooltip
    content={
      <div className="text-xs max-w-xs">
        <div className="font-semibold">{label}</div>
        <div className="text-muted-foreground mt-0.5">{description}</div>
      </div>
    }
  >
    <div
      className="absolute top-0 bottom-0 cursor-help flex items-center justify-center"
      style={{
        left: `${positionPct}%`,
        width: 0,
      }}
    >
      <div
        className="h-full w-0.5 rounded-full"
        style={{ backgroundColor: color, opacity: 0.85 }}
      />
      <div
        className="absolute top-0 h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: color }}
      />
    </div>
  </UxTooltip>
);

export const ChartEventsStrip: FC<{
  events: ChartEvent[];
  xDomain: [number, number];
  className?: string;
}> = ({ events, xDomain, className }) => {
  const { t } = useTranslation();
  const insets = useChartInsets();
  const categoryLabels = useChartEventCategoryLabels();
  // On phone-width viewports the chart area shrinks to ~280px after the
  // y-axis inset. Bands rarely clear the 5% width threshold meaningfully,
  // and partial labels like "СО..." read as garbage. Suppress inline
  // labels entirely on mobile — color + legend + tap-for-tooltip carry
  // the full story.
  const isMobile = useMediaQueryMatch("sm");

  // Group events by category so each gets its own row. Empty rows are
  // dropped to keep the strip as short as possible when the cabinet-
  // detail view filters down to a subset.
  const byCategory = useMemo(() => {
    const map: Partial<Record<ChartEventCategory, ChartEvent[]>> = {};
    for (const e of events) {
      (map[e.category] ??= []).push(e);
    }
    return map;
  }, [events]);

  const visibleRows = ROW_ORDER.filter(
    (cat) => (byCategory[cat]?.length ?? 0) > 0,
  );

  if (visibleRows.length === 0) return null;

  const span = xDomain[1] - xDomain[0];

  return (
    <div className={cn("w-full", className)}>
      <div
        className="relative"
        style={{
          paddingLeft: insets.paddingLeft,
          paddingRight: insets.paddingRight,
        }}
      >
        <div className="flex flex-col gap-0.5">
          {visibleRows.map((cat) => {
            const color = EVENT_CATEGORY_COLOR[cat];
            const row = byCategory[cat] ?? [];
            return (
              <div
                key={cat}
                className="relative w-full"
                style={{ height: ROW_HEIGHT }}
                aria-label={categoryLabels[cat]}
              >
                {row.map((e) => {
                  const startFrac = toFractional(e.start);
                  if (!e.end) {
                    // Point event: vertical marker.
                    const pos = ((startFrac - xDomain[0]) / span) * 100;
                    if (pos < 0 || pos > 100) return null;
                    return (
                      <EventPoint
                        key={e.id}
                        event={e}
                        positionPct={pos}
                        color={color}
                        label={t(e.labelKey)}
                        description={t(e.descriptionKey)}
                      />
                    );
                  }
                  const endFrac = toFractional(e.end);
                  // Clamp to xDomain so events that pre-date 2005 still
                  // appear (their left edge gets cut off).
                  const clampedStart = Math.max(startFrac, xDomain[0]);
                  const clampedEnd = Math.min(endFrac, xDomain[1]);
                  if (clampedEnd <= clampedStart) return null;
                  const startPct = ((clampedStart - xDomain[0]) / span) * 100;
                  const widthPct = ((clampedEnd - clampedStart) / span) * 100;
                  return (
                    <EventBand
                      key={e.id}
                      event={e}
                      startPct={startPct}
                      widthPct={widthPct}
                      color={color}
                      label={t(e.labelKey)}
                      description={t(e.descriptionKey)}
                      hideLabel={isMobile}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      {/* Tiny legend — one chip per visible category. Sits flush with
          the strip insets so the colored swatches line up with the rows
          they describe. */}
      <div
        className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground"
        style={{
          paddingLeft: insets.paddingLeft,
          paddingRight: insets.paddingRight,
        }}
      >
        <span className="uppercase tracking-wide">
          {t("chart_event_legend_label")}
        </span>
        {visibleRows.map((cat) => (
          <span key={cat} className="inline-flex items-center gap-1">
            <span
              aria-hidden
              className="inline-block h-2 w-2 rounded-sm"
              style={{ backgroundColor: EVENT_CATEGORY_COLOR[cat] }}
            />
            {categoryLabels[cat]}
          </span>
        ))}
      </div>
    </div>
  );
};

// Re-export the surface class to avoid an unused-import warning when the
// rich tooltip surface is needed externally.
export { tooltipSurfaceClass };
