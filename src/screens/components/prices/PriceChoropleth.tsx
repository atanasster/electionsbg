// Municipality choropleth for the КЗП price basket — colour each município by
// its basket cost (€) or its change since the euro. Mirrors
// IndicatorsChoroplethMap (LeafletMap base + SVG features + legend + tooltip),
// swapping the value source to ranking.json's muni rows. NOT official CPI.

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigateParams } from "@/ux/useNavigateParams";
import { useTooltip } from "@/ux/useTooltip";
import { useMunicipalities } from "@/data/municipalities/useMunicipalities";
import { useSofiaMergedNationMap } from "@/data/municipalities/useSofiaMergedNationMap";
import { usePriceRanking, fmtEur, fmtPct } from "@/data/prices/usePrices";
import { LeafletMap } from "../maps/LeafletMap";
import { SVGMapContainer } from "../maps/SVGMapContainer";
import { FeatureMap } from "../maps/FeatureMap";
import { getDataProjection } from "../maps/d3_utils";
import type { MapCoordinates } from "@/layout/dataview/MapLayout";
import { sequentialColor } from "../demographics/censusMetrics";

export type PriceMetric = "level" | "change";

// price-data Sofia muni key (SOF46) vs the merged-map key (SOF00)
const mapCode = (rankingCode: string): string =>
  rankingCode === "SOF46" ? "SOF00" : rankingCode;

export const PriceChoropleth: React.FC<{
  metric: PriceMetric;
  size: MapCoordinates;
}> = ({ metric, size }) => {
  const { t, i18n } = useTranslation();
  const lang: "bg" | "en" = i18n.language === "bg" ? "bg" : "en";
  const { tooltip, ...tooltipEvents } = useTooltip();
  const mapGeo = useSofiaMergedNationMap();
  const { findMunicipality } = useMunicipalities();
  const { data: ranking } = usePriceRanking();
  const navigate = useNavigateParams();

  const { valuesByMuni, range } = useMemo(() => {
    const values = new Map<string, number>();
    let min = Infinity;
    let max = -Infinity;
    for (const p of ranking?.places ?? []) {
      if (p.tier !== "muni") continue;
      const v = metric === "level" ? p.basketLevel : p.indexSinceEuro;
      if (v == null || !Number.isFinite(v)) continue;
      values.set(mapCode(p.code), v);
      if (v < min) min = v;
      if (v > max) max = v;
    }
    return {
      valuesByMuni: values,
      range:
        Number.isFinite(min) && max > min
          ? ([min, max] as [number, number])
          : undefined,
    };
  }, [ranking, metric]);

  if (!mapGeo || !ranking || !range) return null;

  const proj = getDataProjection(mapGeo as d3.GeoPermissibleObjects, size);
  // higher value (more expensive / rose more) → darker end, so the eye spots
  // the costliest places. sequentialColor: low = pale yellow, high = indigo.
  const colorAt = (t01: number) => sequentialColor(t01);
  const fmtVal = (v: number): string =>
    metric === "level" ? fmtEur(v, lang) : fmtPct(v / 100 - 1);
  const metricLabel =
    metric === "level"
      ? lang === "bg"
        ? "Цена на кошницата"
        : "Basket cost"
      : lang === "bg"
        ? "Промяна от еврото"
        : "Change since the euro";

  const stops = [0, 0.25, 0.5, 0.75, 1];
  const legend = (
    <div className="absolute bottom-3 left-3 z-[1000] rounded-md bg-background/90 backdrop-blur-sm border border-border shadow-sm px-3 py-2 w-[240px] pointer-events-none">
      <div className="text-[11px] font-medium text-foreground mb-1 truncate">
        {metricLabel}
      </div>
      <div
        className="h-2 w-full rounded-sm border border-border/50"
        style={{
          background: `linear-gradient(to right, ${stops
            .map((s) => `${colorAt(s)} ${(s * 100).toFixed(0)}%`)
            .join(", ")})`,
        }}
        role="img"
        aria-label={`${metricLabel} scale`}
      />
      <div className="flex justify-between text-[10px] text-muted-foreground mt-1 tabular-nums">
        <span>{fmtVal(range[0])}</span>
        <span>{fmtVal(range[1])}</span>
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
            const v = valuesByMuni.get(code);
            const fill =
              v !== undefined
                ? colorAt((v - range[0]) / (range[1] - range[0]))
                : "hsl(0, 0%, 90%)";
            return (
              <FeatureMap
                key={`prices-${idx}`}
                geoPath={proj.path}
                fillColor={fill}
                feature={feature}
                onClick={() => navigate({ pathname: `/governance/${code}` })}
                onMouseEnter={(e) => {
                  const info = findMunicipality(code);
                  const name =
                    code === "SOF00"
                      ? lang === "bg"
                        ? "София"
                        : "Sofia"
                      : info
                        ? lang === "bg"
                          ? info.name
                          : info.name_en
                        : code;
                  tooltipEvents.onMouseEnter(
                    { pageX: e.pageX, pageY: e.pageY },
                    <div className="text-left">
                      <div className="text-base font-semibold pb-1">{name}</div>
                      <div className="text-sm">
                        {metricLabel}:{" "}
                        <span className="font-semibold">
                          {v !== undefined
                            ? fmtVal(v)
                            : lang === "bg"
                              ? "няма данни"
                              : "no data"}
                        </span>
                      </div>
                    </div>,
                  );
                }}
                onMouseMove={(e) =>
                  tooltipEvents.onMouseMove({ pageX: e.pageX, pageY: e.pageY })
                }
                onMouseLeave={tooltipEvents.onMouseLeave}
              />
            );
          })}
        </SVGMapContainer>
        {legend}
        <span className="sr-only">{t("prices_not_cpi")}</span>
      </div>
      {tooltip}
    </div>
  );
};
