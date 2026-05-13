import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigateParams } from "@/ux/useNavigateParams";
import { useTooltip } from "@/ux/useTooltip";
import { useMunicipalities } from "@/data/municipalities/useMunicipalities";
import { useNationMunicipalitiesMap } from "@/data/municipalities/useNationMunicipalitiesMap";
import {
  formatIndicatorValue,
  indicatorHigherIsBetter,
  useIndicators,
  type IndicatorId,
  type IndicatorsPayload,
} from "@/data/indicators/useIndicators";
import { LeafletMap } from "../maps/LeafletMap";
import { SVGMapContainer } from "../maps/SVGMapContainer";
import { FeatureMap } from "../maps/FeatureMap";
import { getDataProjection } from "../maps/d3_utils";
import type { MapCoordinates } from "@/layout/dataview/MapLayout";
import { sequentialColor } from "../demographics/censusMetrics";

const SOFIA_CITY_KEY = "SOF00";

const isSofiaDistrict = (code: string): boolean => /^S2[3-5]\d{2}$/i.test(code);

const resolveValue = (
  payload: IndicatorsPayload,
  id: IndicatorId,
  muniCode: string,
): { value?: number; fallback?: "sofia-city" } => {
  const series = payload.series[id]?.[muniCode];
  if (series && series.length > 0)
    return { value: series[series.length - 1].value };
  if (isSofiaDistrict(muniCode)) {
    const city = payload.series[id]?.[SOFIA_CITY_KEY];
    if (city && city.length > 0)
      return { value: city[city.length - 1].value, fallback: "sofia-city" };
  }
  return {};
};

export const IndicatorsChoroplethMap: React.FC<{
  indicator: IndicatorId;
  size: MapCoordinates;
}> = ({ indicator, size }) => {
  const { t, i18n } = useTranslation();
  const { tooltip, ...tooltipEvents } = useTooltip();
  const mapGeo = useNationMunicipalitiesMap();
  const { findMunicipality } = useMunicipalities();
  const { data: payload } = useIndicators();
  const navigate = useNavigateParams();

  const { path, valuesByMuni, range, latestYear } = useMemo(() => {
    const empty = {
      path: undefined as d3.GeoPath | undefined,
      valuesByMuni: new Map<
        string,
        { value: number; fallback?: "sofia-city" }
      >(),
      range: undefined as [number, number] | undefined,
      latestYear: undefined as number | undefined,
    };
    if (!mapGeo || !payload) return empty;
    const proj = getDataProjection(mapGeo as d3.GeoPermissibleObjects, size);
    const values = new Map<
      string,
      { value: number; fallback?: "sofia-city" }
    >();
    let min = Infinity;
    let max = -Infinity;
    for (const feature of mapGeo.features) {
      const code = feature.properties.nuts4;
      const resolved = resolveValue(payload, indicator, code);
      if (resolved.value === undefined) continue;
      values.set(code, {
        value: resolved.value,
        fallback: resolved.fallback,
      });
      if (resolved.value < min) min = resolved.value;
      if (resolved.value > max) max = resolved.value;
    }
    // Latest year from any series.
    let year: number | undefined;
    const sample = Object.values(payload.series[indicator] ?? {})[0];
    if (sample?.length) year = sample[sample.length - 1].year;
    return {
      path: proj.path,
      valuesByMuni: values,
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
  const indicatorLabel = lang === "bg" ? meta.labelBg : meta.labelEn;
  const unitLabel = lang === "bg" ? meta.unitBg : meta.unitEn;

  const proj = getDataProjection(mapGeo as d3.GeoPermissibleObjects, size);

  // The choropleth's darker end should always represent "worse" so the eye
  // immediately spots distressed regions. For "higher is better" indicators
  // (e.g. DZI scores) that means inverting the value→color mapping so the
  // lowest scores get the darker color. For "higher is worse" (unemployment)
  // the darker end is the highest value — also an inversion of the default
  // sequentialColor ramp, which sends low values to the dark end.
  const inverted = indicatorHigherIsBetter(indicator);
  const colorAt = (t: number) => sequentialColor(inverted ? 1 - t : t);

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
            .map((t) => `${colorAt(t)} ${(t * 100).toFixed(0)}%`)
            .join(", ")})`,
        }}
        role="img"
        aria-label={`${indicatorLabel} scale`}
      />
      <div className="flex justify-between text-[10px] text-muted-foreground mt-1 tabular-nums">
        <span>{formatIndicatorValue(legendValueAt(0))}</span>
        <span>{formatIndicatorValue(legendValueAt(0.5))}</span>
        <span>{formatIndicatorValue(legendValueAt(1))}</span>
      </div>
    </div>
  );

  return (
    <div className="flex w-full">
      <div
        className="relative isolate"
        style={{ width: `${size[0]}px`, height: `${size[1]}px` }}
      >
        <LeafletMap size={size} bounds={proj.bounds} scale={proj.scale} />
        <SVGMapContainer
          size={size}
          supportsShiftArrows={false}
          supportsNames={false}
        >
          {mapGeo.features.map((feature, idx) => {
            const code = feature.properties.nuts4;
            const cell = valuesByMuni.get(code);
            const fill =
              cell !== undefined && range
                ? colorAt((cell.value - range[0]) / (range[1] - range[0]))
                : "hsl(0, 0%, 90%)";
            return (
              <FeatureMap
                key={`indicators-${idx}`}
                geoPath={path}
                fillColor={fill}
                feature={feature}
                onClick={() => {
                  navigate({ pathname: `/settlement/${code}` });
                }}
                onMouseEnter={(e) => {
                  // Sofia districts get the city aggregate value AND a city
                  // label; non-Sofia munis use their own name. Falling back
                  // to the muni code preserves a sensible label if the
                  // lookup somehow misses.
                  const info = findMunicipality(code);
                  const isSofiaFallback = cell?.fallback === "sofia-city";
                  const displayName = isSofiaFallback
                    ? lang === "bg"
                      ? "София (столица)"
                      : "Sofia (city)"
                    : info
                      ? lang === "bg"
                        ? info.long_name || info.name
                        : info.long_name_en || info.name_en
                      : code;
                  tooltipEvents.onMouseEnter(
                    { pageX: e.pageX, pageY: e.pageY },
                    <div className="text-left">
                      <div className="text-base font-semibold pb-1">
                        {displayName}
                      </div>
                      <div className="text-sm">
                        {indicatorLabel}:{" "}
                        <span className="font-semibold">
                          {formatIndicatorValue(cell?.value)}
                        </span>{" "}
                        <span className="text-muted-foreground">
                          {unitLabel}
                        </span>
                      </div>
                      {isSofiaFallback && (
                        <div className="text-[10px] italic text-muted-foreground mt-1">
                          {t("indicators_sofia_city_footnote")}
                        </div>
                      )}
                    </div>,
                  );
                }}
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
