import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useRegionsMap } from "@/data/regions/useRegionsMap";
import regions from "@/data/json/regions.json";
import { oblastToMir } from "@/data/parliament/nsFolders";
import type {
  VoteFlowPersistence,
  VoteFlowPersistenceSummary,
} from "@/data/voteFlows/voteFlowTypes";
import { useTooltip } from "@/ux/useTooltip";
import { MapCoordinates } from "@/layout/dataview/MapLayout";
import { getDataProjection } from "@/screens/components/maps/d3_utils";
import { SVGMapContainer } from "@/screens/components/maps/SVGMapContainer";
import { FeatureMap } from "@/screens/components/maps/FeatureMap";
import { LeafletMap } from "@/screens/components/maps/LeafletMap";
import {
  sequentialColor,
  sequentialLegend,
} from "@/screens/components/charts/sequentialScale";
import { formatPct } from "@/data/utils";
import { RegionJSONProps } from "@/screens/components/maps/mapTypes";

// Per-region choropleth of voter persistence (% of named-party voters who
// stayed with the same party across the selected cycle pair). Sequential
// Greens — darker green = more loyal. Domain 0–100% with a fixed cap so
// the same value reads the same intensity across cycle pairs.
const DOMAIN_MAX_PCT = 80;

type RegionMeta = {
  oblast: string;
  name?: string;
  name_en?: string;
  long_name?: string;
  long_name_en?: string;
};

export const PersistenceRegionsMap: FC<{
  size: MapCoordinates;
  summary?: VoteFlowPersistenceSummary;
  selectedKey?: string;
  onSelect?: (key: string | undefined) => void;
}> = ({ size, summary, selectedKey, onSelect }) => {
  const { t, i18n } = useTranslation();
  const mapGeo = useRegionsMap();
  const { tooltip, ...tooltipEvents } = useTooltip();

  const { path, bounds, scale } = useMemo(() => {
    if (!mapGeo) {
      return {
        path: undefined,
        bounds: undefined,
        scale: 1,
      } as ReturnType<typeof getDataProjection> & { path: undefined };
    }
    return getDataProjection(
      mapGeo as unknown as d3.GeoPermissibleObjects,
      size,
    );
  }, [mapGeo, size]);

  // The vote-flow summary keys oblasts by 2-digit MIR ("01"..."31"); the
  // GeoJSON's `nuts3` field carries the alpha oblast code (BLG, S24, …).
  // Convert oblast → MIR via the shared table.
  const byMir = useMemo(() => {
    const m = new Map<string, VoteFlowPersistence>();
    summary?.byOblast.forEach((r) => m.set(r.oblast, r.persistence));
    return m;
  }, [summary]);

  const legend = useMemo(() => sequentialLegend(DOMAIN_MAX_PCT, "Greens"), []);

  if (!mapGeo || !path) return null;

  return (
    <div className="flex w-full">
      <div className="relative" style={{ width: size[0], height: size[1] }}>
        <LeafletMap size={size} bounds={bounds} scale={scale} />
        <SVGMapContainer
          size={size}
          supportsShiftArrows={false}
          supportsNames={true}
        >
          {mapGeo.features.map((feature, idx) => {
            const props = feature.properties as RegionJSONProps;
            const mir = oblastToMir(props.nuts3);
            const persistence = mir ? byMir.get(mir) : undefined;
            const info = regions.find((r) => r.oblast === props.nuts3) as
              | RegionMeta
              | undefined;
            const sharePct = persistence
              ? persistence.stayRate * 100
              : undefined;
            const fillColor = sequentialColor(
              sharePct,
              DOMAIN_MAX_PCT,
              "Greens",
            );
            const lang = i18n.language;
            const isSelected = selectedKey === props.nuts3;
            return (
              <g
                key={`pers-map-${idx}`}
                className={
                  isSelected
                    ? "[&_path]:stroke-foreground [&_path]:stroke-[3]"
                    : ""
                }
              >
                <FeatureMap
                  geoPath={path}
                  feature={feature}
                  fillColor={fillColor}
                  onClick={() =>
                    onSelect?.(isSelected ? undefined : props.nuts3)
                  }
                  onMouseEnter={(e) => {
                    const regionName =
                      lang === "bg"
                        ? info?.long_name || info?.name
                        : info?.long_name_en || info?.name_en;
                    tooltipEvents.onMouseEnter(
                      { pageX: e.pageX, pageY: e.pageY },
                      <div className="space-y-1">
                        <div className="font-semibold text-base">
                          {regionName || props.nuts3}
                        </div>
                        <div>
                          {t("persistence_stay_rate")}:{" "}
                          <span className="font-mono">
                            {formatPct(sharePct, 1)}
                          </span>
                        </div>
                      </div>,
                    );
                  }}
                  onMouseMove={tooltipEvents.onMouseMove}
                  onMouseLeave={tooltipEvents.onMouseLeave}
                />
              </g>
            );
          })}
        </SVGMapContainer>
        {/* Legend pinned bottom-left of the map — same convention as the
            wasted-vote map. */}
        <div
          className="absolute bottom-2 left-2 z-[400] bg-card/90 backdrop-blur-sm border rounded-md px-2 py-1.5 text-[10px] md:text-xs shadow-sm"
          aria-label={t("persistence_legend_title")}
        >
          <div className="font-semibold pb-1 hidden md:block">
            {t("persistence_legend_title")}
          </div>
          <div className="flex md:flex-col gap-0.5 md:gap-1">
            {legend.map((bucket, i) => (
              <div
                key={i}
                className="flex flex-col md:flex-row items-center md:gap-2 gap-0"
              >
                <span
                  className="block w-6 h-3 md:w-4 md:h-4 rounded-sm border border-border"
                  style={{ background: bucket.color }}
                />
                <span className="font-mono text-muted-foreground">
                  {bucket.to.toFixed(0)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
      {tooltip}
    </div>
  );
};
