import { MapCoordinates } from "@/layout/dataview/MapLayout";
import { useTooltip } from "@/ux/useTooltip";
import { useMunicipalitiesMap } from "@/data/municipalities/useMunicipalitiesMap";
import { useMunicipalities } from "@/data/municipalities/useMunicipalities";
import { MunicipalityJSONProps } from "../maps/mapTypes";
import { useMapElements } from "../maps/useMapElements";
import { SVGMapContainer } from "../maps/SVGMapContainer";
import { LeafletMap } from "../maps/LeafletMap";
import { useMunicipalitiesByRegion } from "@/data/municipalities/useMunicipalitiesByRegion";

export const MunicipalitiesMap: React.FC<{
  region: string;
  size: MapCoordinates;
  withNames: boolean;
}> = ({ size, withNames, region }) => {
  const { tooltip, ...tooltipEvents } = useTooltip();
  const votes = useMunicipalitiesByRegion(region);
  const mapGeo = useMunicipalitiesMap(region);

  const { findMunicipality } = useMunicipalities();
  const findInfo = (props: MunicipalityJSONProps) =>
    findMunicipality(props.nuts4);
  const findVotes = (props: MunicipalityJSONProps) =>
    votes?.find((v) => props.nuts4 === v.obshtina);

  const { maps, labels, markers, bounds, scale } =
    useMapElements<MunicipalityJSONProps>({
      findInfo,
      findVotes,
      mapGeo,
      size,
      votes,
      withNames,
      onClick: (props) => ({
        pathname: `/settlement/${props.nuts4}`,
      }),
      ...tooltipEvents,
    });

  return (
    <div>
      <div className="relative">
        <LeafletMap size={size} bounds={bounds} scale={scale} />
        <SVGMapContainer size={size}>
          {maps}
          {markers}
          {labels}
        </SVGMapContainer>
      </div>
      {tooltip}
    </div>
  );
};
