import { ReactNode, useMemo } from "react";
import { GeoJSONMap, GeoJSONProps } from "./mapTypes";
import { ElectionResults, LocationInfo } from "@/data/dataTypes";
import { MapElement } from "./MapElement";
import { MapText } from "./MapText";
import { MapMarker } from "./MapMarker";
import { MapShiftArrow } from "./MapShiftArrow";
import { RegionShift } from "./computeShifts";
import { minMaxVotes } from "@/data/utils";
import { getDataProjection } from "@/screens/components/maps/d3_utils";
import { MapCoordinates } from "@/layout/dataview/MapLayout";
import { NavigateParams } from "@/ux/useNavigateParams";
import { TooltipEvents } from "@/ux/useTooltip";
import { useOptions } from "@/layout/dataview/OptionsContext";

type MapElementsList = {
  maps: (ReactNode | undefined)[];
  labels: (ReactNode | undefined)[];
  markers: (ReactNode | undefined)[];
};
export function useMapElements<DType extends GeoJSONProps>({
  mapGeo,
  votes,
  size,
  findInfo,
  findVotes,
  findShift,
  onClick,
  ...tooltipEvents
}: {
  mapGeo?: GeoJSONMap<DType>;
  votes?: ElectionResults[];
  size: MapCoordinates;

  findVotes: (props: DType) => ElectionResults | undefined;
  findInfo: (props: DType) => LocationInfo | undefined;
  findShift?: (props: DType) => RegionShift | undefined;
  onClick: (props: DType) => NavigateParams;
} & TooltipEvents): MapElementsList & {
  bounds: [[number, number], [number, number]];
  scale: number;
} {
  const { path, projection, bounds, scale } = useMemo(
    () => getDataProjection(mapGeo as d3.GeoPermissibleObjects, size),
    [mapGeo, size],
  );
  const { withNames, withShiftArrows } = useOptions();
  const { maxVotes, minVotes } = useMemo(() => minMaxVotes(votes), [votes]);
  return {
    bounds,
    scale,
    ...useMemo(() => {
      return mapGeo && votes
        ? mapGeo.features.reduce(
            (acc: MapElementsList, feature, idx) => {
              const v = findVotes(feature.properties);
              const info = findInfo(feature.properties);
              const shift = findShift?.(feature.properties);
              return {
                maps: [
                  ...acc.maps,
                  feature && (
                    <MapElement<DType>
                      key={`map-${idx}`}
                      opacity={withNames ? undefined : 0.5}
                      feature={feature}
                      geoPath={path}
                      info={info}
                      votes={v?.results.votes}
                      shift={shift}
                      onClick={onClick}
                      {...tooltipEvents}
                    />
                  ),
                ],
                labels: [
                  ...acc.labels,
                  feature && withNames && (
                    <MapText
                      key={`marker-${idx}`}
                      info={info}
                      projection={projection}
                      feature={feature}
                    />
                  ),
                ],
                markers: [
                  ...acc.markers,
                  withShiftArrows &&
                  shift?.deltaPp !== undefined &&
                  Math.abs(shift.deltaPp) >= 0.25 ? (
                    <MapShiftArrow
                      info={info}
                      key={`shift-${idx}`}
                      projection={projection}
                      shift={shift}
                    />
                  ) : (
                    <MapMarker
                      info={info}
                      key={`label-${idx}`}
                      projection={projection}
                      minVotes={minVotes}
                      maxVotes={maxVotes}
                      votes={v?.results.votes}
                    />
                  ),
                ],
              };
            },
            { labels: [], maps: [], markers: [] },
          )
        : { labels: [], maps: [], markers: [] };
    }, [
      mapGeo,
      votes,
      findVotes,
      findInfo,
      findShift,
      path,
      onClick,
      tooltipEvents,
      withNames,
      withShiftArrows,
      projection,
      minVotes,
      maxVotes,
    ]),
  };
}
