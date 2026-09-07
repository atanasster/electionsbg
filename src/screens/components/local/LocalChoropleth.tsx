// Generic local-elections choropleth.
//
// The parliamentary map stack (useMapElements → MapElement) bakes winner
// resolution into `usePartyInfo().topVotesParty(votes)`, so it can't render a
// "which party holds the most mayoralties here" fill. This component reuses
// the same projection + Leaflet + SVG primitives but takes the fill colour and
// tooltip straight from local data via `colorOf` / `tooltipOf` props — no
// coupling to parliamentary party hooks.

import type { GeoPermissibleObjects } from "d3-geo";
import { ReactNode, useMemo } from "react";
import { getDataProjection } from "@/screens/components/maps/d3_utils";
import { SVGMapContainer } from "@/screens/components/maps/SVGMapContainer";
import { LeafletMap } from "@/screens/components/maps/LeafletMap";
import { FeatureMap } from "@/screens/components/maps/FeatureMap";
import { GeoJSONMap, GeoJSONProps } from "@/screens/components/maps/mapTypes";
import { MapCoordinates } from "@/layout/dataview/MapLayout";
import { useTooltip } from "@/ux/useTooltip";
import { NavigateParams, useNavigateParams } from "@/ux/useNavigateParams";

export function LocalChoropleth<DType extends GeoJSONProps>({
  size,
  mapGeo,
  colorOf,
  tooltipOf,
  ariaLabelOf,
  onClickPath,
  overlay,
}: {
  size: MapCoordinates;
  mapGeo?: GeoJSONMap<DType>;
  colorOf: (props: DType) => string | undefined;
  tooltipOf: (props: DType) => ReactNode;
  /** What a screen reader announces for one region — and, because `FeatureMap`
   *  derives keyboard access as `!!ariaLabel && !!onClick`, ALSO what makes the
   *  region focusable and activatable at all.
   *
   *  ⚠ WITHOUT IT EVERY FEATURE HERE IS MOUSE-ONLY, silently: the fill, the
   *  tooltip and the click-through all work, so nothing looks wrong, and a
   *  keyboard reaches none of them. It is optional only so existing callers
   *  keep their current behaviour until each states its own label; a caller
   *  that declares an `interactive` posture to the election shell must pass it,
   *  because that posture is a claim this prop is what honours. */
  ariaLabelOf?: (props: DType) => string | undefined;
  onClickPath: (props: DType) => NavigateParams;
  // Absolutely-positioned corner overlay(s) rendered over the map — e.g. the
  // Sofia-city shortcut tile. Positioned by the overlay itself relative to
  // `size`, matching the parliamentary RegionsMap (SofiaCity / WorldLink).
  overlay?: ReactNode;
}) {
  const { tooltip, onMouseEnter, onMouseMove, onMouseLeave } = useTooltip();
  const navigate = useNavigateParams();
  const { path, bounds, scale } = useMemo(
    () => getDataProjection(mapGeo as GeoPermissibleObjects, size),
    [mapGeo, size],
  );
  if (!mapGeo) return null;
  return (
    <div className="flex w-full">
      <div className="relative">
        <LeafletMap size={size} bounds={bounds} scale={scale} />
        <SVGMapContainer
          size={size}
          supportsShiftArrows={false}
          supportsNames={false}
        >
          {mapGeo.features.map((feature, idx) => (
            <FeatureMap
              key={`local-map-${idx}`}
              geoPath={path}
              feature={feature}
              fillColor={colorOf(feature.properties) ?? "hsl(var(--muted))"}
              ariaLabel={ariaLabelOf?.(feature.properties)}
              onMouseEnter={(e) =>
                onMouseEnter(
                  { pageX: e.pageX, pageY: e.pageY },
                  tooltipOf(feature.properties),
                )
              }
              onMouseMove={(e) =>
                onMouseMove({ pageX: e.pageX, pageY: e.pageY })
              }
              onMouseLeave={onMouseLeave}
              onClick={() => navigate(onClickPath(feature.properties))}
            />
          ))}
        </SVGMapContainer>
        {overlay}
      </div>
      {tooltip}
    </div>
  );
}
