import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigateParams } from "@/ux/useNavigateParams";
import { useTooltip } from "@/ux/useTooltip";
import { useRegions } from "@/data/regions/useRegions";
import { useRegionsMap } from "@/data/regions/useRegionsMap";
import {
  useRegional,
  formatRegionalValue,
  type RegionalIndicatorKey,
} from "@/data/regional/useRegional";
import { LeafletMap } from "../maps/LeafletMap";
import { SVGMapContainer } from "../maps/SVGMapContainer";
import { FeatureMap } from "../maps/FeatureMap";
import { getDataProjection } from "../maps/d3_utils";
import type { MapCoordinates } from "@/layout/dataview/MapLayout";
import { sequentialColor } from "../demographics/censusMetrics";

// Latest value per oblast for the chosen indicator. Returns the last
// available year's value (most indicators publish annually with a one-year
// lag, so this is normally last year). When an oblast has no data we omit
// it from the map — the FeatureMap will render in the neutral fill colour.
const buildLatestByOblast = (
  payload: ReturnType<typeof useRegional>["data"],
  key: RegionalIndicatorKey,
): Map<string, number> => {
  const out = new Map<string, number>();
  if (!payload) return out;
  const byOblast = payload.series[key] ?? {};
  for (const [code, series] of Object.entries(byOblast)) {
    if (!series.length) continue;
    out.set(code, series[series.length - 1].value);
  }
  return out;
};

export const RegionalChoroplethMap: React.FC<{
  indicator: RegionalIndicatorKey;
  size: MapCoordinates;
}> = ({ indicator, size }) => {
  const { i18n } = useTranslation();
  const { tooltip, ...tooltipEvents } = useTooltip();
  const mapGeo = useRegionsMap();
  const { findRegion } = useRegions();
  const { data: payload } = useRegional();
  const navigate = useNavigateParams();

  const { path, valuesByOblast, range, latestYear } = useMemo(() => {
    const empty = {
      path: undefined as d3.GeoPath | undefined,
      valuesByOblast: new Map<string, number>(),
      range: undefined as [number, number] | undefined,
      latestYear: undefined as number | undefined,
    };
    if (!mapGeo || !payload) return empty;
    const proj = getDataProjection(mapGeo as d3.GeoPermissibleObjects, size);
    const values = buildLatestByOblast(payload, indicator);
    let min = Infinity;
    let max = -Infinity;
    for (const v of values.values()) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
    // Latest year across the series — they're all aligned to the same
    // annual cadence so any oblast works.
    let year: number | undefined;
    const sample = Object.values(payload.series[indicator] ?? {})[0];
    if (sample?.length) year = sample[sample.length - 1].year;
    return {
      path: proj.path,
      valuesByOblast: values,
      range:
        Number.isFinite(min) && Number.isFinite(max) && max > min
          ? ([min, max] as [number, number])
          : undefined,
      latestYear: year,
    };
  }, [mapGeo, payload, indicator, size]);

  if (!mapGeo || !payload || !path) return null;

  const meta = payload.indicators[indicator];
  const lang = i18n.language;
  const indicatorLabel = lang === "bg" ? meta.titleBg : meta.titleEn;
  const unitLabel = lang === "bg" ? meta.unitLabelBg : meta.unitLabelEn;

  const proj = getDataProjection(mapGeo as d3.GeoPermissibleObjects, size);

  const legendStops = [0, 0.25, 0.5, 0.75, 1];
  const legendValueAt = (t: number): number | undefined => {
    if (!range) return undefined;
    return range[0] + (range[1] - range[0]) * t;
  };
  const legend = range && (
    <div className="absolute bottom-3 left-3 z-[1000] rounded-md bg-background/90 backdrop-blur-sm border border-border shadow-sm px-3 py-2 w-[240px] pointer-events-none">
      <div className="text-[11px] font-medium text-foreground mb-0.5 truncate">
        {indicatorLabel}
      </div>
      <div className="text-[10px] text-muted-foreground mb-1">
        {unitLabel}
        {latestYear !== undefined ? ` · ${latestYear}` : null}
      </div>
      <div
        className="h-2 w-full rounded-sm border border-border/50"
        style={{
          background: `linear-gradient(to right, ${legendStops
            .map((t) => `${sequentialColor(t)} ${(t * 100).toFixed(0)}%`)
            .join(", ")})`,
        }}
        role="img"
        aria-label={`${indicatorLabel} scale`}
      />
      <div className="flex justify-between text-[10px] text-muted-foreground mt-1 tabular-nums">
        <span>{formatRegionalValue(indicator, legendValueAt(0), lang)}</span>
        <span>{formatRegionalValue(indicator, legendValueAt(0.5), lang)}</span>
        <span>{formatRegionalValue(indicator, legendValueAt(1), lang)}</span>
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
            // regions_map.json's `nuts3` property is actually our internal
            // oblast code (BLG, S23, ...), which is the same key the
            // regional payload is indexed on — no translation needed.
            const oblastCode = feature.properties.nuts3 as string;
            const value = valuesByOblast.get(oblastCode);
            const fill =
              value !== undefined && range
                ? sequentialColor((value - range[0]) / (range[1] - range[0]))
                : "hsl(0, 0%, 90%)";
            const info = findRegion(oblastCode);
            return (
              <FeatureMap
                key={`regional-${idx}`}
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
                          : oblastCode}
                      </div>
                      <div className="text-sm">
                        {indicatorLabel}:{" "}
                        <span className="font-semibold">
                          {formatRegionalValue(indicator, value, lang)}
                        </span>{" "}
                        <span className="text-muted-foreground">
                          {unitLabel}
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
