import { MapCoordinates } from "@/layout/MapLayout";
import { SVGMapContainer } from "./maps/SVGMapContainer";
import { useTooltip } from "@/ux/useTooltip";
import { useMapElements } from "./maps/useMapElements";
import { useMunicipalitiesMap } from "@/data/municipalities/useMunicipalitiesMap";
import { useMunicipalities } from "@/data/municipalities/useMunicipalities";
import { MunicipalityJSONProps } from "./maps/mapTypes";
import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { ElectionMunicipality } from "@/data/dataTypes";
import { useElectionContext } from "@/data/ElectionContext";

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<[string, string | null | undefined, string]>): Promise<
  ElectionMunicipality[]
> => {
  if (!queryKey[1]) {
    return [];
  }
  const response = await fetch(
    `/${queryKey[1]}/municipalities/by/${queryKey[2]}.json`,
  );
  const data = await response.json();
  return data;
};

export const MunicipalitiesMap: React.FC<{
  region: string;
  size: MapCoordinates;
  withNames: boolean;
}> = ({ size, withNames, region }) => {
  const { selected } = useElectionContext();
  const { data: votes } = useQuery({
    queryKey: ["settlements_by_municipality", selected, region],
    queryFn,
    enabled: !!selected,
  });
  const { tooltip, ...tooltipEvents } = useTooltip();
  const mapGeo = useMunicipalitiesMap(region);

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
      pathname: `/settlement/${props.nuts4}`,
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
