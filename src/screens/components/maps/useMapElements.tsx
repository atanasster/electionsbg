import { ReactNode, useMemo } from "react";
import { GeoJSONMap, GeoJSONProps } from "./mapTypes";
import { ElectionResults, LocationInfo } from "@/data/dataTypes";
import { MapElement } from "./MapElement";
import { MapText } from "./MapText";
import { MapMarker } from "./MapMarker";
import { minMaxVotes } from "@/data/utils";
import { getDataProjection } from "@/screens/utils/d3_utils";
import { MapCoordinates } from "@/layout/MapLayout";
import { NavigateParams } from "@/ux/useNavigateParams";
import { TooltipEvents } from "@/ux/useTooltip";

type MapElementsList = {
  maps: (ReactNode | undefined)[];
  labels: (ReactNode | undefined)[];
  markers: (ReactNode | undefined)[];
};
export function useMapElements<DType extends GeoJSONProps>({
  mapGeo,
  votes,
  size,
  withNames,
  findInfo,
  findVotes,
  onClick,
  ...tooltipEvents
}: {
  mapGeo?: GeoJSONMap<DType>;
  votes?: ElectionResults[];
  size: MapCoordinates;
  withNames: boolean;
  findVotes: (props: DType) => ElectionResults | undefined;
  findInfo: (props: DType) => LocationInfo | undefined;
  onClick: (props: DType) => NavigateParams;
} & TooltipEvents): MapElementsList {
  const { path, projection } = useMemo(
    () => getDataProjection(mapGeo as d3.GeoPermissibleObjects, size),
    [mapGeo, size],
  );
  const { maxVotes, minVotes } = useMemo(() => minMaxVotes(votes), [votes]);
  return useMemo(() => {
    return mapGeo && votes
      ? mapGeo.features.reduce(
          (acc: MapElementsList, feature) => {
            const v = findVotes(feature.properties);
            const info = findInfo(feature.properties);
            return {
              maps: [
                ...acc.maps,
                feature && (
                  <MapElement<DType>
                    key={`map-${info?.name}`}
                    feature={feature}
                    geoPath={path}
                    info={info}
                    votes={v?.results.votes}
                    onClick={onClick}
                    {...tooltipEvents}
                  />
                ),
              ],
              labels: [
                ...acc.labels,
                feature && withNames && (
                  <MapText
                    key={`marker-${info?.name}`}
                    info={info}
                    projection={projection}
                    feature={feature}
                  />
                ),
              ],
              markers: [
                ...acc.markers,
                <MapMarker
                  info={info}
                  key={`label-${info?.name}`}
                  projection={projection}
                  minVotes={minVotes}
                  maxVotes={maxVotes}
                  votes={v?.results.votes}
                />,
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
    path,
    onClick,
    tooltipEvents,
    withNames,
    projection,
    minVotes,
    maxVotes,
  ]);
}
