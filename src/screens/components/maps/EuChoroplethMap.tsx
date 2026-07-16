import { FC, useMemo } from "react";
import * as d3 from "d3";
import { useTooltip } from "@/ux/useTooltip";
import { useEuropeGeo } from "@/data/maps/useEuropeGeo";
import { euGeoName } from "./euGeoNames";
import { sequentialColor } from "../demographics/censusMetrics";

// Reusable EU country choropleth. Feed it a map of Eurostat geo code → value and
// it colours the European frame (darker = higher, Eurostat-style), greys geos
// with no value, and outlines the highlighted country (BG by default). Fully
// self-contained — no map context providers — so it drops onto any page
// (sector dashboards, /indicators/compare, …). Geometry is bucket-served
// (data/maps/europe/countries.json); the value payload decides which geos light
// up, so it only reads as "complete" when the ingest carries the full 27-member
// cross-section.

// Core frame for the projection fit; far/edge geos (TR, UA, CY, IS…) still render
// but are cropped by the viewport, matching the Eurostat map's European window.
const FIT_EXCLUDE = new Set(["TR", "UA", "BY", "MD", "CY", "IS", "MT", "XK"]);
const DEFAULT_AGGREGATES = ["EU27_2020", "EA"];

export const EuChoroplethMap: FC<{
  /**
   * Eurostat geo code → value. Every non-excluded geo present here is coloured;
   * the colour domain is `[min,max]` over these values (see `scaleGeos` to pin
   * it). Geos absent here render grey ("no data").
   */
  valuesByGeo: Record<string, number | null | undefined>;
  bg: boolean;
  title?: string;
  unit?: string;
  year?: number;
  format?: (v: number) => string;
  /** Country to outline (default BG). */
  highlightGeo?: string;
  /** Geos excluded from the colour scale (aggregates); default EU27/EA. */
  excludeFromScale?: string[];
  /**
   * Restrict the colour domain to these geos (e.g. the EU-27 set) so non-EU
   * neighbours present in `valuesByGeo` don't stretch the scale. Neighbours are
   * still drawn — coloured if in range, otherwise clamped to the ramp ends.
   * When omitted the domain spans every non-excluded geo in `valuesByGeo`.
   */
  scaleGeos?: string[];
  width?: number;
  height?: number;
}> = ({
  valuesByGeo,
  bg,
  title,
  unit,
  year,
  format,
  highlightGeo = "BG",
  excludeFromScale = DEFAULT_AGGREGATES,
  scaleGeos,
  width = 640,
  height = 460,
}) => {
  const { data: geo } = useEuropeGeo();
  const { tooltip, ...tt } = useTooltip();
  const exclude = useMemo(() => new Set(excludeFromScale), [excludeFromScale]);
  const scaleSet = useMemo(
    () => (scaleGeos ? new Set(scaleGeos) : null),
    [scaleGeos],
  );
  const fmt = format ?? ((v: number) => `${v.toFixed(1)}%`);

  const { path, range } = useMemo(() => {
    if (!geo)
      return { path: undefined as d3.GeoPath | undefined, range: undefined };
    const fit = {
      type: "FeatureCollection" as const,
      features: geo.features.filter((f) => !FIT_EXCLUDE.has(f.properties.geo)),
    };
    // Conic conformal is the standard European projection (≈ EPSG:3035) and,
    // unlike azimuthal-equal-area, has no antipodal-disc failure mode for
    // European polygons. Parallels/rotation frame the continent; fitSize scales.
    const projection = d3
      .geoConicConformal()
      .parallels([43, 62])
      .rotate([-10, 0])
      .fitSize([width, height], fit as d3.GeoPermissibleObjects);
    const p = d3.geoPath(projection);
    let min = Infinity;
    let max = -Infinity;
    for (const [g, v] of Object.entries(valuesByGeo)) {
      if (exclude.has(g) || v == null) continue;
      if (scaleSet && !scaleSet.has(g)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const range =
      Number.isFinite(min) && Number.isFinite(max) && max > min
        ? ([min, max] as [number, number])
        : undefined;
    return { path: p, range };
  }, [geo, valuesByGeo, exclude, scaleSet, width, height]);

  if (!geo || !path) {
    return (
      <div
        className="w-full animate-pulse rounded-md bg-muted/40"
        style={{ aspectRatio: `${width} / ${height}` }}
      />
    );
  }

  const colorAt = (v: number): string =>
    range ? sequentialColor((v - range[0]) / (range[1] - range[0])) : "grey";

  const legendStops = [0, 0.25, 0.5, 0.75, 1];
  const legendValueAt = (t: number): number | undefined =>
    range ? range[0] + (range[1] - range[0]) * t : undefined;

  const noData = bg ? "няма данни" : "no data";
  const valueOf = (g: string): number | undefined =>
    valuesByGeo[g] != null && !exclude.has(g)
      ? (valuesByGeo[g] as number)
      : undefined;
  // Plain-text label for the native <title> (assistive tech + non-JS hover).
  const titleFor = (g: string): string => {
    const v = valueOf(g);
    return `${euGeoName(g, bg)}: ${v != null ? fmt(v) : noData}`;
  };
  const tipNode = (g: string) => {
    const v = valueOf(g);
    return (
      <div className="text-left">
        <div className="pb-0.5 text-sm font-semibold">{euGeoName(g, bg)}</div>
        <div className="text-sm">
          {v != null ? (
            <span className="font-semibold tabular-nums">{fmt(v)}</span>
          ) : (
            <span className="text-muted-foreground">{noData}</span>
          )}
        </div>
      </div>
    );
  };

  return (
    // The shared useTooltip positions with page coordinates, so {tooltip} must
    // sit OUTSIDE the relative container (matching the other choropleths) — an
    // absolute tooltip inside it would offset by the container origin, overflow,
    // and the transient scrollbar would nudge the map on hover.
    <div className="w-full">
      <div className="relative isolate w-full">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-auto w-full overflow-hidden"
          role="img"
          aria-label={title ?? (bg ? "Карта на Европа" : "Map of Europe")}
        >
          {geo.features.map((f) => {
            const g = f.properties.geo;
            const v = valuesByGeo[g];
            const hasV = v != null && !exclude.has(g);
            const isHi = g === highlightGeo;
            return (
              <path
                key={g}
                d={path(f as unknown as d3.GeoPermissibleObjects) ?? undefined}
                fill={hasV ? colorAt(v as number) : "hsl(var(--muted))"}
                stroke={
                  isHi ? "hsl(var(--foreground))" : "hsl(var(--background))"
                }
                strokeWidth={isHi ? 1.6 : 0.4}
                strokeLinejoin="round"
                className="cursor-default"
                onMouseEnter={(e) =>
                  tt.onMouseEnter(
                    { pageX: e.pageX, pageY: e.pageY },
                    tipNode(g),
                  )
                }
                onMouseMove={(e) =>
                  tt.onMouseMove({ pageX: e.pageX, pageY: e.pageY })
                }
                onMouseLeave={tt.onMouseLeave}
                // Tap surfaces the same tooltip on touch devices (no hover).
                onClick={(e) =>
                  tt.onMouseEnter(
                    { pageX: e.pageX, pageY: e.pageY },
                    tipNode(g),
                  )
                }
              >
                <title>{titleFor(g)}</title>
              </path>
            );
          })}
        </svg>

        {range && (
          // Below the map on narrow viewports (in normal flow); floats as an
          // overlay on the lower-left from sm upward.
          <div className="pointer-events-none mt-2 w-full rounded-md border border-border bg-background/90 px-3 py-2 shadow-sm sm:absolute sm:bottom-2 sm:left-2 sm:mt-0 sm:w-[220px] sm:backdrop-blur-sm">
            {title && (
              <div className="mb-0.5 truncate text-[11px] font-medium text-foreground">
                {title}
              </div>
            )}
            <div className="mb-1 text-[10px] text-muted-foreground">
              {unit}
              {year !== undefined ? ` · ${year}` : null}
            </div>
            <div
              className="h-2 w-full rounded-sm border border-border/50"
              style={{
                background: `linear-gradient(to right, ${legendStops
                  .map((t) => `${sequentialColor(t)} ${(t * 100).toFixed(0)}%`)
                  .join(", ")})`,
              }}
            />
            <div className="mt-1 flex justify-between text-[10px] tabular-nums text-muted-foreground">
              <span>{fmt(legendValueAt(0) ?? 0)}</span>
              <span>{fmt(legendValueAt(1) ?? 0)}</span>
            </div>
          </div>
        )}
      </div>
      {tooltip}
    </div>
  );
};
