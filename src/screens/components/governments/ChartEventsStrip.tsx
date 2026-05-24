// Compact event strip rendered immediately below the GovernmentTimeline
// chart. Aligns to the same x-axis via the shared ChartInsets so a band
// labelled "COVID" sits directly under the 2020–2022 stretch of the
// macro chart.
//
// Two lanes:
//   - lane 0 (economic): crisis + pandemic events, sharing the row since
//     they don't overlap in BG 2005+ history. Each event keeps its
//     category-specific color, so "amber" and "violet" still read as
//     distinct categories within the lane.
//   - lane 1 (civic):    protest events.
//
// Bands (events with a start + end) render as translucent rectangles
// with a short label (e.g. "КТБ", "COVID", "2020") inline when the band
// is wide enough — the full label lives in the tooltip. Point events
// (start only) render as a thin vertical line + dot.
//
// No category legend below the strip: the inline short labels carry the
// identity, and any band too narrow for even the short label has a
// tooltip on hover/tap.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Tooltip as UxTooltip } from "@/ux/Tooltip";
import { useMediaQueryMatch } from "@/ux/useMediaQueryMatch";
import { useChartInsets } from "./governmentChartInsets";
import {
  EVENT_CATEGORY_COLOR,
  EVENT_LANES,
  type ChartEvent,
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

const LANE_HEIGHT = 14; // px per lane

// Width threshold (% of strip width) below which the inline short label
// is suppressed. ~1.5% on a 1360px desktop chart = 20px = room for 3-char
// labels at the 9px font size. On mobile the chart shrinks to ~290px so
// 1.5% = 4px — too narrow for even one character; the truncated "Г.." and
// "СО..." that results reads as garbage. We disable inline labels entirely
// on mobile and rely on tap-for-tooltip + the colored band itself.
const SHORT_LABEL_MIN_WIDTH_PCT = 1.5;

const EventBand: FC<{
  startPct: number;
  widthPct: number;
  color: string;
  fullLabel: string;
  shortLabel: string;
  description: string;
  hideInlineLabel?: boolean;
}> = ({
  startPct,
  widthPct,
  color,
  fullLabel,
  shortLabel,
  description,
  hideInlineLabel,
}) => {
  const showInlineLabel =
    !hideInlineLabel && widthPct >= SHORT_LABEL_MIN_WIDTH_PCT;
  return (
    <UxTooltip
      content={
        <div className="text-xs max-w-xs">
          <div className="font-semibold">{fullLabel}</div>
          <div className="text-muted-foreground mt-0.5">{description}</div>
        </div>
      }
    >
      <div
        className="absolute top-0 bottom-0 cursor-help rounded-sm flex items-center px-1 overflow-hidden text-[9px] font-medium text-white whitespace-nowrap"
        style={{
          left: `${startPct}%`,
          width: `${widthPct}%`,
          backgroundColor: color,
          opacity: 0.78,
        }}
      >
        {showInlineLabel ? (
          <span className="truncate leading-none">{shortLabel}</span>
        ) : null}
      </div>
    </UxTooltip>
  );
};

const EventPoint: FC<{
  positionPct: number;
  color: string;
  fullLabel: string;
  description: string;
}> = ({ positionPct, color, fullLabel, description }) => (
  <UxTooltip
    content={
      <div className="text-xs max-w-xs">
        <div className="font-semibold">{fullLabel}</div>
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
  const isMobile = useMediaQueryMatch("sm");

  // Pack events into the configured lanes. Each lane filters the full
  // event list to its assigned categories — preserves chronological
  // order without needing a sort (the source list is already
  // chronological).
  const lanesWithEvents = useMemo(() => {
    return EVENT_LANES.map((categories) =>
      events.filter((e) => categories.includes(e.category)),
    );
  }, [events]);

  const visibleLanes = lanesWithEvents.filter((lane) => lane.length > 0);
  if (visibleLanes.length === 0) return null;

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
          {visibleLanes.map((lane, laneIdx) => (
            <div
              key={laneIdx}
              className="relative w-full"
              style={{ height: LANE_HEIGHT }}
            >
              {lane.map((e) => {
                const color = EVENT_CATEGORY_COLOR[e.category];
                const fullLabel = t(e.labelKey);
                const shortLabel = t(e.shortLabelKey);
                const description = t(e.descriptionKey);
                const startFrac = toFractional(e.start);
                if (!e.end) {
                  const pos = ((startFrac - xDomain[0]) / span) * 100;
                  if (pos < 0 || pos > 100) return null;
                  return (
                    <EventPoint
                      key={e.id}
                      positionPct={pos}
                      color={color}
                      fullLabel={fullLabel}
                      description={description}
                    />
                  );
                }
                const endFrac = toFractional(e.end);
                const clampedStart = Math.max(startFrac, xDomain[0]);
                const clampedEnd = Math.min(endFrac, xDomain[1]);
                if (clampedEnd <= clampedStart) return null;
                const startPct = ((clampedStart - xDomain[0]) / span) * 100;
                const widthPct = ((clampedEnd - clampedStart) / span) * 100;
                return (
                  <EventBand
                    key={e.id}
                    startPct={startPct}
                    widthPct={widthPct}
                    color={color}
                    fullLabel={fullLabel}
                    shortLabel={shortLabel}
                    description={description}
                    hideInlineLabel={isMobile}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
