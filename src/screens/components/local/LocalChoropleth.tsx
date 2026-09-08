// Generic local-elections choropleth.
//
// The parliamentary map stack (useMapElements → MapElement) bakes winner
// resolution into `usePartyInfo().topVotesParty(votes)`, so it can't render a
// "which party holds the most mayoralties here" fill. This component reuses
// the same projection + Leaflet + SVG primitives but takes the fill colour and
// tooltip straight from local data via `colorOf` / `tooltipOf` props — no
// coupling to parliamentary party hooks.
//
// ⚠ `infoOf`/`markerValueOf` ARE OPT-IN, and existing callers (the local-elections dashboard
// tiles) omit both — their maps stay exactly as they were: solid fill, no toggle, no markers.
// Supplying `infoOf` opts a caller into the SAME "show names / full opacity" control
// `useMapElements`-backed maps already have (the Layers2 button, `useOptions().withNames`):
// semi-transparent fill with sized `MapMarker`s by default, opaque with `MapText` labels once a
// reader switches it on. One shared toggle, not a second one — see SVGMapContainer.

import type { GeoPermissibleObjects } from "d3-geo";
import { ReactNode, useMemo } from "react";
import { getDataProjection } from "@/screens/components/maps/d3_utils";
import { SVGMapContainer } from "@/screens/components/maps/SVGMapContainer";
import { LeafletMap } from "@/screens/components/maps/LeafletMap";
import { FeatureMap } from "@/screens/components/maps/FeatureMap";
import { MapText } from "@/screens/components/maps/MapText";
import { MapMarker } from "@/screens/components/maps/MapMarker";
import { GeoJSONMap, GeoJSONProps } from "@/screens/components/maps/mapTypes";
import { MapCoordinates } from "@/layout/dataview/MapLayout";
import { LocationInfo } from "@/data/dataTypes";
import { useTooltip } from "@/ux/useTooltip";
import { NavigateParams, useNavigateParams } from "@/ux/useNavigateParams";
import { useOptions } from "@/layout/dataview/OptionsContext";

export function LocalChoropleth<DType extends GeoJSONProps>({
  size,
  mapGeo,
  colorOf,
  tooltipOf,
  ariaLabelOf,
  onClickPath,
  overlay,
  infoOf,
  markerValueOf,
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
  /** Per-feature place info (name + centroid). Supplying this is what turns the map into a
   *  full "show names" surface: it drives the semi-transparent-by-default fill, the `MapText`
   *  label layer once the reader switches names on, and `MapMarker`'s pin position. Omit it to
   *  keep the map solid-filled with no toggle button — today's behaviour. */
  infoOf?: (props: DType) => LocationInfo | undefined;
  /** Sizes each place's marker (e.g. total votes cast there). Read only when `infoOf` is also
   *  given; a place with no value (or `infoOf` omitted) draws no marker for it. */
  markerValueOf?: (props: DType) => number | undefined;
}) {
  const { tooltip, onMouseEnter, onMouseMove, onMouseLeave } = useTooltip();
  const navigate = useNavigateParams();
  const { withNames } = useOptions();
  const { path, projection, bounds, scale } = useMemo(
    () => getDataProjection(mapGeo as GeoPermissibleObjects, size),
    [mapGeo, size],
  );
  // Range for MapMarker's size scale — over every place THIS map covers, not the whole corpus,
  // matching how useMapElements scopes minMaxVotes to its own mapGeo/votes pair.
  const { minValue, maxValue } = useMemo(() => {
    if (!mapGeo || !infoOf || !markerValueOf)
      return { minValue: 0, maxValue: 0 };
    const values = mapGeo.features
      .map((f) => markerValueOf(f.properties))
      .filter((v): v is number => typeof v === "number" && v > 0);
    return values.length
      ? { minValue: Math.min(...values), maxValue: Math.max(...values) }
      : { minValue: 0, maxValue: 0 };
  }, [mapGeo, infoOf, markerValueOf]);
  if (!mapGeo) return null;
  const showNamesToggle = !!infoOf;
  return (
    <div className="flex w-full">
      <div className="relative">
        <LeafletMap size={size} bounds={bounds} scale={scale} />
        <SVGMapContainer
          size={size}
          supportsShiftArrows={false}
          supportsNames={showNamesToggle}
        >
          {mapGeo.features.map((feature, idx) => (
            <FeatureMap
              key={`local-map-${idx}`}
              geoPath={path}
              feature={feature}
              fillColor={colorOf(feature.properties) ?? "hsl(var(--muted))"}
              opacity={
                showNamesToggle ? (withNames ? undefined : 0.5) : undefined
              }
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
          {showNamesToggle &&
            withNames &&
            mapGeo.features.map((feature, idx) => {
              const info = infoOf(feature.properties);
              return (
                info && (
                  <MapText
                    key={`local-name-${idx}`}
                    info={info}
                    projection={projection}
                    feature={feature}
                  />
                )
              );
            })}
          {showNamesToggle &&
            markerValueOf &&
            mapGeo.features.map((feature, idx) => (
              <MapMarker
                key={`local-marker-${idx}`}
                info={infoOf(feature.properties)}
                projection={projection}
                minVotes={minValue}
                maxVotes={maxValue}
                value={markerValueOf(feature.properties)}
              />
            ))}
        </SVGMapContainer>
        {overlay}
      </div>
      {tooltip}
    </div>
  );
}
