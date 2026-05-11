import { FC, useMemo } from "react";
import { useRegionsMap } from "@/data/regions/useRegionsMap";
import regions from "@/data/json/regions.json";
import { useRegionWastedVotes } from "@/data/wastedVote/useWastedVote";
import { usePartyInfo } from "@/data/parties/usePartyInfo";
import { useTooltip } from "@/ux/useTooltip";
import { useTranslation } from "react-i18next";
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

// Per-region choropleth coloring each NUTS3 area by wasted-vote share.
// Sequential YlOrRd (more wasted = darker red). Click drills to the
// region detail page.
//
// Domain cap (25%) spans BG history: 2024_10 was ~4% at the low end,
// 2013 was ~24% at the high end. A fixed cap keeps the perceptual
// mapping stable across elections so the same color always reads the
// same intensity.
const DOMAIN_MAX_PCT = 25;

export const WastedVoteRegionsMap: FC<{
  size: MapCoordinates;
  selectedKey?: string;
  onSelect?: (key: string | undefined) => void;
}> = ({ size, selectedKey, onSelect }) => {
  const { t, i18n } = useTranslation();
  const mapGeo = useRegionsMap();
  const { data: regionRows } = useRegionWastedVotes();
  const { findParty } = usePartyInfo();
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

  // NOTE: regions_map.json's `nuts3` property actually contains the oblast
  // code (BLG, S24, …), not the real NUTS3 code (BG413, BG417). Match the
  // rollup by `key` instead.
  const byKey = useMemo(() => {
    const m = new Map<string, NonNullable<typeof regionRows>[number]>();
    regionRows?.forEach((r) => m.set(r.key, r));
    return m;
  }, [regionRows]);

  const legend = useMemo(() => sequentialLegend(DOMAIN_MAX_PCT, "YlOrRd"), []);

  if (!mapGeo || !path) return null;

  return (
    <div className="flex w-full">
      {/* Map container sized to match the map area exactly so the legend
          overlay anchors to the visible map bounds. Using size[0]/size[1]
          rather than CSS classes keeps it in lockstep with MapLayout's
          ResizeObserver — no feedback loop because our `.relative` adds
          no content beyond what the LeafletMap occupies. */}
      <div className="relative" style={{ width: size[0], height: size[1] }}>
        <LeafletMap size={size} bounds={bounds} scale={scale} />
        <SVGMapContainer
          size={size}
          supportsShiftArrows={false}
          supportsNames={true}
        >
          {mapGeo.features.map((feature, idx) => {
            const props = feature.properties as RegionJSONProps;
            const row = byKey.get(props.nuts3);
            const info = regions.find((r) => r.oblast === props.nuts3) as
              | {
                  name?: string;
                  name_en?: string;
                  long_name?: string;
                  long_name_en?: string;
                }
              | undefined;
            const fillColor = sequentialColor(
              row?.share,
              DOMAIN_MAX_PCT,
              "YlOrRd",
            );
            const lang = i18n.language;
            const isSelected = selectedKey === props.nuts3;
            return (
              <g
                key={`wv-map-${idx}`}
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
                    const topParties = row?.topParties ?? [];
                    tooltipEvents.onMouseEnter(
                      { pageX: e.pageX, pageY: e.pageY },
                      <div className="space-y-1">
                        <div className="font-semibold text-base">
                          {regionName || props.nuts3}
                        </div>
                        <div>
                          {t("wasted_votes_title")}:{" "}
                          <span className="font-mono">
                            {formatPct(row?.share, 2)}
                          </span>
                        </div>
                        {topParties.length > 0 && (
                          <div className="pt-1">
                            <div className="text-xs text-muted-foreground pb-1">
                              {t("wasted_votes_top_parties")}
                            </div>
                            <ul className="text-xs space-y-0.5">
                              {topParties.slice(0, 3).map((p) => {
                                const party = findParty(p.partyNum);
                                const label =
                                  party?.nickName ||
                                  party?.name ||
                                  `#${p.partyNum}`;
                                return (
                                  <li key={p.partyNum}>
                                    {label} —{" "}
                                    <span className="font-mono">
                                      {formatPct(p.share, 2)}
                                    </span>
                                  </li>
                                );
                              })}
                            </ul>
                          </div>
                        )}
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
        {/* Legend pinned to bottom-left of the map as an overlay (matches
            the convention of the existing leaflet attribution at bottom).
            Avoids competing for layout height with the absolutely-positioned
            LeafletMap/SVGMapContainer pair. */}
        <div
          className="absolute bottom-2 left-2 z-[400] bg-card/90 backdrop-blur-sm border rounded-md px-2 py-1.5 text-[10px] md:text-xs shadow-sm"
          aria-label={t("wasted_votes_legend_title")}
        >
          <div className="font-semibold pb-1 hidden md:block">
            {t("wasted_votes_legend_title")}
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
