// Generic oblast choropleth — one metric, one map. Extracted from
// ProcurementOblastMap so every domain (procurement, culture, water, …) draws
// the same Sofia-merged region map with per-oblast percentile colouring, instead
// of each cloning the projection + tooltip + click-to-filter plumbing.
// (docs/plans/kultura-view-v1.md §3.1d — "extract & consume".)
//
// The caller supplies a `values` map (canonical oblast code → number) plus a
// formatter and a ramp; this component owns the geometry. Sofia draws as one
// polygon (regions_map.json merges the three МИР into "SOF"), and the colour
// scale is percentile-based over the DISTINCT oblast values so Sofia's dominant
// figure doesn't wash out the rest.

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
import { featureToCanon } from "@/data/procurement/useProcurementByOblast";

const NO_DATA = "hsl(var(--muted))";

/** A neutral single-hue sequential ramp (light → dark primary). Callers may pass
 *  their own domain ramp. */
const DEFAULT_OBLAST_RAMP = [
  "hsl(var(--muted))",
  "hsl(var(--primary) / 0.25)",
  "hsl(var(--primary) / 0.45)",
  "hsl(var(--primary) / 0.65)",
  "hsl(var(--primary) / 0.85)",
  "hsl(var(--primary))",
] as const;

export const OblastChoropleth: FC<{
  /** canonical oblast code → metric value (undefined = no data). */
  values: Map<string, number | undefined>;
  /** canonical oblast code → display name (tooltip label + click payload). */
  names?: Map<string, string>;
  ramp?: readonly string[];
  formatValue: (v: number | undefined) => string;
  /** Extra tooltip line under the value (e.g. "9 institutes"). */
  tooltipExtra?: (canon: string) => ReactNode;
  activeCanon?: string | null;
  onSelectOblast?: (canon: string, name: string) => void;
  ariaLabel: string;
  /** Height class for the map box. */
  heightClass?: string;
}> = ({
  values,
  names,
  ramp = DEFAULT_OBLAST_RAMP,
  formatValue,
  tooltipExtra,
  activeCanon,
  onSelectOblast,
  ariaLabel,
  heightClass = "h-[240px] md:h-[260px]",
}) => {
  const mapGeo = useSofiaMergedRegionsMap();
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<MapCoordinates | undefined>();
  const { tooltip, onMouseEnter, onMouseMove, onMouseLeave } = useTooltip();

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

  // Percentile thresholds from the DISTINCT per-oblast values (not per feature —
  // so Sofia's three МИР features don't skew the scale).
  const sorted = useMemo(() => {
    const vals = [...values.values()]
      .filter((v): v is number => v != null)
      .sort((a, b) => a - b);
    return vals;
  }, [values]);

  const colorFor = (v: number | undefined): string => {
    if (v == null || sorted.length === 0) return NO_DATA;
    const rank = sorted.filter((x) => x <= v).length / sorted.length;
    const idx = Math.min(ramp.length - 1, Math.floor(rank * ramp.length));
    return ramp[idx];
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
              const canon = featureToCanon(code);
              const v = values.get(canon);
              const name = names?.get(canon);
              const has = values.has(canon);
              const dimmed = !!activeCanon && canon !== activeCanon;
              return (
                <FeatureMap
                  key={`${code}-${idx}`}
                  feature={feature}
                  geoPath={projection.path}
                  fillColor={colorFor(v)}
                  opacity={dimmed ? 0.3 : 1}
                  onCursor={() =>
                    has && onSelectOblast ? "pointer" : "default"
                  }
                  ariaLabel={
                    has && onSelectOblast
                      ? `${name ?? canon}: ${formatValue(v)}`
                      : undefined
                  }
                  onClick={() => {
                    if (has && onSelectOblast)
                      onSelectOblast(canon, name ?? canon);
                  }}
                  onMouseEnter={(e) =>
                    onMouseEnter(
                      { pageX: e.pageX, pageY: e.pageY },
                      <div className="flex flex-col gap-0.5">
                        <span className="font-medium">{name ?? code}</span>
                        <span className="tabular-nums">{formatValue(v)}</span>
                        {tooltipExtra ? (
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {tooltipExtra(canon)}
                          </span>
                        ) : null}
                      </div>,
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
      {tooltip}
    </>
  );
};
