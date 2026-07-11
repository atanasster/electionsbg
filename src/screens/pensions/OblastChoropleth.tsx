// Shared oblast choropleth for the /pensions maps (average pension, cash-vs-bank
// share). Encapsulates the map machinery both tiles duplicated: the measure
// block (ResizeObserver), the d3 projection, the percentile colour scale, the
// <svg> + FeatureMap render, the gradient legend, and the tooltip portal.
//
// Each caller supplies only what differs — the metric accessor, the light/dark
// ramp, the tooltip renderer, and the legend label formatter. The tile keeps its
// own Card / header / caption / side content (the oblast tile pairs this with a
// sorted bar list; the cash tile renders it full-width).

import {
  FC,
  ReactNode,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSofiaMergedRegionsMap } from "@/data/regions/useSofiaMergedRegionsMap";
import { getDataProjection } from "@/screens/components/maps/d3_utils";
import { FeatureMap } from "@/screens/components/maps/FeatureMap";
import { useTooltip } from "@/ux/useTooltip";
import { MapCoordinates } from "@/layout/dataview/MapLayout";
import { useIsDark } from "@/screens/components/procurement/chartColors";
import type { NoiPensionOblastRow } from "@/data/budget/types";

const NO_DATA = "hsl(var(--muted))";

export interface OblastChoroplethProps {
  rows: NoiPensionOblastRow[];
  rowForFeature: (nuts3: string) => NoiPensionOblastRow | undefined;
  /** The value that drives the colour scale; null hides the oblast (NO_DATA). */
  valueFor: (row: NoiPensionOblastRow) => number | null | undefined;
  rampLight: string[];
  rampDark: string[];
  ariaLabel: string;
  /** Tooltip body for a matched oblast (owns the null-metric case itself). */
  tooltip: (row: NoiPensionOblastRow) => ReactNode;
  /** Tooltip body when a map feature has no matching oblast row at all. */
  noDataLabel: ReactNode;
  legendFormat: (v: number) => string;
  heightClass?: string;
}

export const OblastChoropleth: FC<OblastChoroplethProps> = ({
  rows,
  rowForFeature,
  valueFor,
  rampLight,
  rampDark,
  ariaLabel,
  tooltip,
  noDataLabel,
  legendFormat,
  heightClass = "h-[300px] md:h-[340px]",
}) => {
  const mapGeo = useSofiaMergedRegionsMap();
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<MapCoordinates | undefined>();
  const {
    tooltip: tip,
    onMouseEnter,
    onMouseMove,
    onMouseLeave,
  } = useTooltip();
  const RAMP = useIsDark() ? rampDark : rampLight;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () =>
      setSize([el.offsetWidth, el.offsetHeight, el.offsetLeft, el.offsetTop]);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const projection = useMemo(
    () =>
      mapGeo && size
        ? getDataProjection(
            mapGeo as Parameters<typeof getDataProjection>[0],
            size,
          )
        : null,
    [mapGeo, size],
  );

  // Percentile thresholds from the reporting oblasti (one per bucket).
  const sorted = useMemo(() => {
    const vs: number[] = [];
    for (const r of rows) {
      const v = valueFor(r);
      if (v != null) vs.push(v);
    }
    return vs.sort((a, b) => a - b);
  }, [rows, valueFor]);

  const colorFor = (v: number | null | undefined): string => {
    if (v == null || sorted.length === 0) return NO_DATA;
    const rank = sorted.filter((x) => x <= v).length / sorted.length;
    return RAMP[Math.min(RAMP.length - 1, Math.floor(rank * RAMP.length))];
  };

  return (
    <>
      <div ref={ref} className={`relative w-full ${heightClass}`}>
        {projection && mapGeo ? (
          <svg
            width={size?.[0]}
            height={size?.[1]}
            viewBox={`0 0 ${size?.[0]} ${size?.[1]}`}
            className="overflow-visible"
            role="img"
            aria-label={ariaLabel}
          >
            {mapGeo.features.map((feature, idx) => {
              const code = feature.properties.nuts3;
              const row = rowForFeature(code);
              return (
                <FeatureMap
                  key={`${code}-${idx}`}
                  feature={feature}
                  geoPath={projection.path}
                  fillColor={colorFor(row ? valueFor(row) : undefined)}
                  onMouseEnter={(e) =>
                    onMouseEnter(
                      { pageX: e.pageX, pageY: e.pageY },
                      row ? tooltip(row) : noDataLabel,
                    )
                  }
                  onMouseMove={(e) =>
                    onMouseMove({ pageX: e.pageX, pageY: e.pageY })
                  }
                  onMouseLeave={onMouseLeave}
                />
              );
            })}
          </svg>
        ) : null}
      </div>
      {sorted.length > 0 && (
        <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground">
          <span className="tabular-nums">{legendFormat(sorted[0])}</span>
          {/* Discrete swatches — one per RAMP bucket — mirror the stepped fill
              (colorFor snaps each oblast to a bucket, so a continuous gradient
              would misrepresent the map). */}
          <div className="flex h-2 flex-1 overflow-hidden rounded-sm border border-border/50">
            {RAMP.map((c, i) => (
              <div key={i} className="flex-1" style={{ background: c }} />
            ))}
          </div>
          <span className="tabular-nums">
            {legendFormat(sorted[sorted.length - 1])}
          </span>
        </div>
      )}
      {tip}
    </>
  );
};
