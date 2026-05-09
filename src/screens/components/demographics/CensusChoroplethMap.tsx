import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigateParams } from "@/ux/useNavigateParams";
import { useTooltip } from "@/ux/useTooltip";
import { useRegions } from "@/data/regions/useRegions";
import { useRegionsMap } from "@/data/regions/useRegionsMap";
import {
  useCensus,
  censusMetricValue,
  oblastToCensusCode,
} from "@/data/census/useCensus";
import { LeafletMap } from "../maps/LeafletMap";
import { SVGMapContainer } from "../maps/SVGMapContainer";
import { FeatureMap } from "../maps/FeatureMap";
import { getDataProjection } from "../maps/d3_utils";
import type { MapCoordinates } from "@/layout/dataview/MapLayout";
import type { CensusMetric } from "@/data/census/censusTypes";
import {
  sequentialColor,
  formatMetricValue,
  METRIC_BY_KEY,
} from "./censusMetrics";

export const CensusChoroplethMap: React.FC<{
  metric: CensusMetric;
  size: MapCoordinates;
}> = ({ metric, size }) => {
  const { t, i18n } = useTranslation();
  const { tooltip, ...tooltipEvents } = useTooltip();
  const mapGeo = useRegionsMap();
  const { findRegion } = useRegions();
  const { data: census } = useCensus();
  const navigate = useNavigateParams();

  const { path, valuesByOblast, range } = useMemo(() => {
    const empty = {
      path: undefined as d3.GeoPath | undefined,
      valuesByOblast: new Map<string, number>(),
      range: undefined as [number, number] | undefined,
    };
    if (!mapGeo || !census) return empty;
    const proj = getDataProjection(mapGeo as d3.GeoPermissibleObjects, size);
    const values = new Map<string, number>();
    for (const oblast of census.oblasts) {
      const v = censusMetricValue(oblast, metric);
      if (v !== undefined) values.set(oblast.code, v);
    }
    let min = Infinity;
    let max = -Infinity;
    for (const v of values.values()) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
    return {
      path: proj.path,
      valuesByOblast: values,
      range:
        Number.isFinite(min) && Number.isFinite(max) && max > min
          ? ([min, max] as [number, number])
          : undefined,
    };
  }, [mapGeo, census, metric, size]);

  if (!mapGeo || !census || !path) {
    return null;
  }

  const metricLabel = t(METRIC_BY_KEY[metric].i18nKey);
  const lang = i18n.language;

  const proj = getDataProjection(mapGeo as d3.GeoPermissibleObjects, size);

  // 5-stop legend gradient that mirrors the sequentialColor() ramp on the
  // map. Tick labels use the metric's natural formatting (count for
  // population, percentage for shares). The legend overlays the bottom-left
  // of the map so it travels with the map and doesn't fight the
  // absolutely-positioned leaflet/SVG layers' lack of contributed height.
  const legendStops = [0, 0.25, 0.5, 0.75, 1];
  const legendValueAt = (t: number): number | undefined => {
    if (!range) return undefined;
    return range[0] + (range[1] - range[0]) * t;
  };
  const legend = range && (
    <div
      className="absolute bottom-3 left-3 z-[1000] rounded-md bg-background/90 backdrop-blur-sm border border-border shadow-sm px-3 py-2 w-[220px] pointer-events-none"
    >
      <div className="text-[11px] font-medium text-foreground mb-1 truncate">
        {metricLabel}
      </div>
      <div
        className="h-2 w-full rounded-sm border border-border/50"
        style={{
          background: `linear-gradient(to right, ${legendStops
            .map((t) => `${sequentialColor(t)} ${(t * 100).toFixed(0)}%`)
            .join(", ")})`,
        }}
        role="img"
        aria-label={`${metricLabel} scale`}
      />
      <div className="flex justify-between text-[10px] text-muted-foreground mt-1 tabular-nums">
        <span>{formatMetricValue(legendValueAt(0), metric, lang)}</span>
        <span>{formatMetricValue(legendValueAt(0.5), metric, lang)}</span>
        <span>{formatMetricValue(legendValueAt(1), metric, lang)}</span>
      </div>
    </div>
  );

  return (
    <div className="flex w-full">
      <div
        className="relative"
        style={{ width: `${size[0]}px`, height: `${size[1]}px` }}
      >
        <LeafletMap size={size} bounds={proj.bounds} scale={proj.scale} />
        <SVGMapContainer
          size={size}
          supportsShiftArrows={false}
          supportsNames={false}
        >
          {mapGeo.features.map((feature, idx) => {
            // Despite being named `nuts3` in regions_map.json, this property
            // is actually our internal oblast code (BLG, S23, PDV-00, ...).
            // Resolve it to the NSI oblast code the census file is keyed on.
            const oblastCode = oblastToCensusCode(feature.properties.nuts3);
            const value = oblastCode
              ? valuesByOblast.get(oblastCode)
              : undefined;
            const fill =
              value !== undefined && range
                ? sequentialColor((value - range[0]) / (range[1] - range[0]))
                : "hsl(0, 0%, 90%)";
            const info = findRegion(feature.properties.nuts3);
            return (
              <FeatureMap
                key={`census-${idx}`}
                geoPath={path}
                fillColor={fill}
                feature={feature}
                onClick={() => {
                  if (info?.oblast)
                    navigate({ pathname: `/municipality/${info.oblast}` });
                }}
                onMouseEnter={(e) =>
                  tooltipEvents.onMouseEnter(
                    { pageX: e.pageX, pageY: e.pageY },
                    <div className="text-left">
                      <div className="text-base font-semibold pb-1">
                        {info
                          ? lang === "bg"
                            ? info.long_name || info.name
                            : info.long_name_en || info.name_en
                          : feature.properties.nuts3}
                      </div>
                      <div className="text-sm">
                        {metricLabel}:{" "}
                        <span className="font-semibold">
                          {formatMetricValue(value, metric, lang)}
                        </span>
                      </div>
                    </div>,
                  )
                }
                onMouseMove={(e) =>
                  tooltipEvents.onMouseMove({
                    pageX: e.pageX,
                    pageY: e.pageY,
                  })
                }
                onMouseLeave={tooltipEvents.onMouseLeave}
              />
            );
          })}
        </SVGMapContainer>
        {legend}
      </div>
      {tooltip}
    </div>
  );
};
