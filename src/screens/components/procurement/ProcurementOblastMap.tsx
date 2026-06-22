// One procurement choropleth for a single metric. Presentational sibling of
// ProcurementChoroplethTile, which renders three of these as dashboard tiles
// (small multiples) instead of one map with metric toggle buttons.
//
// It reuses the Sofia-merged region GeoJSON (regions_map.json with the three
// parliamentary МИР collapsed into one Столична-община polygon keyed "SOF"),
// the d3 projection helper, and the FeatureMap path primitive, colouring each
// oblast by the given procurement metric. Procurement has a single value per
// oblast, so — like the census and Eurostat regional maps — Sofia must draw as
// one polygon, not three identical МИР. The colour scale is percentile-based
// per map, so Sofia's dominant total doesn't wash out the rest. Clicking an
// oblast bubbles the canonical bucket code up so the table can filter to it.

import { FC, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSofiaMergedRegionsMap } from "@/data/regions/useSofiaMergedRegionsMap";
import { getDataProjection } from "@/screens/components/maps/d3_utils";
import { FeatureMap } from "@/screens/components/maps/FeatureMap";
import { useTooltip } from "@/ux/useTooltip";
import { MapCoordinates } from "@/layout/dataview/MapLayout";
import { formatEur } from "@/lib/currency";
import {
  useProcurementByOblast,
  featureToCanon,
  type OblastMetric,
} from "@/data/procurement/useProcurementByOblast";
import { PROCUREMENT_RAMP } from "@/screens/components/procurement/procurementPalette";

const RAMP = PROCUREMENT_RAMP;
const NO_DATA = "hsl(var(--muted))";

export const ProcurementOblastMap: FC<{
  metric: OblastMetric;
  /** Canonical bucket code of the oblast currently filtering the table. */
  activeCanon?: string | null;
  /** Fired with the canonical code + display name of a clicked oblast. */
  onSelectOblast?: (canon: string, name: string) => void;
}> = ({ metric, activeCanon, onSelectOblast }) => {
  const { t } = useTranslation();
  const mapGeo = useSofiaMergedRegionsMap();
  const { buckets, valueFor } = useProcurementByOblast();
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

  // Percentile thresholds from the per-oblast values for THIS metric (one per
  // oblast, not per feature — so Sofia's three features don't skew it).
  const sorted = useMemo(() => {
    const vals = [...buckets.values()]
      .map((b) =>
        metric === "total"
          ? b.totalEur
          : metric === "avg"
            ? b.contractCount > 0
              ? b.totalEur / b.contractCount
              : undefined
            : b.population > 0
              ? b.totalEur / b.population
              : undefined,
      )
      .filter((v): v is number => v != null)
      .sort((a, b) => a - b);
    return vals;
  }, [buckets, metric]);

  const colorFor = (v: number | undefined): string => {
    if (v == null || sorted.length === 0) return NO_DATA;
    const rank = sorted.filter((x) => x <= v).length / sorted.length;
    const idx = Math.min(RAMP.length - 1, Math.floor(rank * RAMP.length));
    return RAMP[idx];
  };

  const fmt = (v: number | undefined): string => {
    if (v == null) return "—";
    if (metric === "perCapita")
      return `${formatEur(v)}${t("procurement_map_per_resident_unit") || "/cap"}`;
    return formatEur(v);
  };

  // {tooltip} must be a sibling of the (relative) map div, not a child —
  // useTooltip positions with page coordinates, so its offset parent has to be
  // the document, matching the PriceChoropleth / RegionsMap convention.
  return (
    <>
      <div ref={ref} className="relative w-full h-[240px] md:h-[260px]">
        {projection && mapGeo ? (
          <svg
            width={size?.[0]}
            height={size?.[1]}
            viewBox={`0 0 ${size?.[0]} ${size?.[1]}`}
            className="overflow-visible"
            role="img"
            aria-label={t(`procurement_map_metric_${metric}`) || metric}
          >
            {mapGeo.features.map((feature, idx) => {
              const code = feature.properties.nuts3;
              const canon = featureToCanon(code);
              const v = valueFor(code, metric);
              const b = buckets.get(canon);
              const dimmed = !!activeCanon && canon !== activeCanon;
              return (
                <FeatureMap
                  key={`${code}-${idx}`}
                  feature={feature}
                  geoPath={projection.path}
                  fillColor={colorFor(v)}
                  opacity={dimmed ? 0.3 : 1}
                  onCursor={() => (b ? "pointer" : "default")}
                  onClick={() => {
                    if (b && onSelectOblast) onSelectOblast(canon, b.name);
                  }}
                  onMouseEnter={(e) =>
                    onMouseEnter(
                      { pageX: e.pageX, pageY: e.pageY },
                      <div className="flex flex-col gap-0.5">
                        <span className="font-medium">{b?.name ?? code}</span>
                        <span className="tabular-nums">{fmt(v)}</span>
                        {b ? (
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {b.contractCount.toLocaleString("bg-BG")}{" "}
                            {t("procurement_map_contracts") || "contracts"}
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
