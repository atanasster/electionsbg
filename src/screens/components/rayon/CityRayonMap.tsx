// Leaflet choropleth of an община с районно деление's районы — the same map
// machinery the Sofia МИР pages use (MunicipalitiesMap), but fed by the
// additive район layer (useCityRayons) instead of the municipality data tree.
// Each район polygon is winner-coloured (MapElement reads the район's votes),
// hover shows the per-party tally, and the marker is a vote-sized dot at the
// район centroid. Click drills into the район's own parliamentary page (the
// map lives on the parent city's parliamentary view, so it stays in that view).

import { FC } from "react";
import { MapCoordinates } from "@/layout/dataview/MapLayout";
import { useTooltip } from "@/ux/useTooltip";
import { useMapElements } from "../maps/useMapElements";
import { SVGMapContainer } from "../maps/SVGMapContainer";
import { LeafletMap } from "../maps/LeafletMap";
import { MunicipalityJSONProps, MunicipalityGeoJSON } from "../maps/mapTypes";
import { ElectionResults, LocationInfo } from "@/data/dataTypes";
import {
  useCityRayonResults,
  useCityRayonMap,
} from "@/data/rayon/useCityRayons";

export const CityRayonMap: FC<{
  municipalityCode: string;
  size: MapCoordinates;
}> = ({ municipalityCode, size }) => {
  const { tooltip, ...tooltipEvents } = useTooltip();
  const { data } = useCityRayonResults(municipalityCode);
  const { data: geo } = useCityRayonMap(municipalityCode);
  const rayons = data?.rayons ?? [];

  const findVotes = (props: MunicipalityJSONProps) =>
    rayons.find((r) => r.obshtina === props.nuts4) as
      | ElectionResults
      | undefined;
  const findInfo = (props: MunicipalityJSONProps): LocationInfo | undefined => {
    const f = geo?.features.find((ft) => ft.properties.nuts4 === props.nuts4);
    if (!f) return undefined;
    return {
      ekatte: f.properties.nuts4,
      name: f.properties.name,
      name_en: f.properties.name_en,
      oblast: f.properties.nuts3,
      loc: f.properties.loc,
    };
  };

  const { maps, labels, markers, bounds, scale } =
    useMapElements<MunicipalityJSONProps>({
      findInfo,
      findVotes,
      mapGeo: (geo as unknown as MunicipalityGeoJSON) ?? undefined,
      size,
      votes: rayons as unknown as ElectionResults[],
      onClick: (props) => ({ pathname: `/settlement/${props.nuts4}` }),
      ...tooltipEvents,
    });

  return (
    <div>
      <div className="relative">
        <LeafletMap size={size} bounds={bounds} scale={scale} />
        <SVGMapContainer size={size} supportsShiftArrows={false}>
          {maps}
          {markers}
          {labels}
        </SVGMapContainer>
      </div>
      {tooltip}
    </div>
  );
};
