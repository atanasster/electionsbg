import { MapCoordinates } from "@/layout/MapLayout";
import { SVGMapContainer } from "./maps/SVGMapContainer";
import { useTooltip } from "@/ux/useTooltip";
import { useMapElements } from "./maps/useMapElements";
import { useMunicipalitiesMap } from "@/data/useMunicipalitiesMap";
import { useMunicipalityVotes } from "@/data/useMunicipalityVotes";
import { useMunicipalities } from "@/data/useMunicipalities";
import { MunicipalityJSONProps } from "./maps/mapTypes";

export const MunicipalitiesMap: React.FC<{
  region: string;
  size: MapCoordinates;
  withNames: boolean;
}> = ({ size, withNames, region }) => {
  const { tooltip, ...tooltipEvents } = useTooltip();
  const mapGeo = useMunicipalitiesMap(region);
  const { municipalitiesByRegion } = useMunicipalityVotes();
  const votes = municipalitiesByRegion(region);
  const { findMunicipality } = useMunicipalities();
  const findInfo = (props: MunicipalityJSONProps) =>
    findMunicipality(props.nuts4);
  const findVotes = (props: MunicipalityJSONProps) =>
    votes?.find((v) => props.nuts4 === v.obshtina);

  const { maps, labels, markers } = useMapElements<MunicipalityJSONProps>({
    findInfo,
    findVotes,
    mapGeo,
    size,
    votes,
    withNames,
    onClick: (props) => ({
      pathname: "/settlement",
      search: {
        municipality: props.nuts4,
      },
    }),
    ...tooltipEvents,
  });

  return (
    <div>
      <div className="relative">
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
