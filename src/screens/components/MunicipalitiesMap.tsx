import { useMunicipalitydVotes } from "@/data/useMunicipalityVotes";
import { useMunicipalities } from "@/data/useMunicipalities";
import { useNavigateParams } from "@/ux/useNavigateParams";
import { MapCoordinates } from "@/layout/MapLayout";
import { useMunicipalitiesMap } from "@/data/useMunicipalitiesMap";
import { GeoJSONMap } from "./maps/GeoJSONMap";
import { MunicipalityJSONProps } from "@/data/mapTypes";

export const MunicipalitiesMap: React.FC<
  React.PropsWithChildren<{
    region: string;
    size: MapCoordinates;
  }>
> = ({ region, size, children }) => {
  const navigate = useNavigateParams();
  const { findMunicipality } = useMunicipalities();
  const { votesByMunicipality } = useMunicipalitydVotes();
  const municipalities = useMunicipalitiesMap(region);
  const findInfo = (props: MunicipalityJSONProps) => {
    return findMunicipality(getName(props));
  };
  const findVotes = (props: MunicipalityJSONProps) => {
    return votesByMunicipality(getName(props))?.results.votes;
  };
  const getName = (props: MunicipalityJSONProps) => {
    return props.nuts4;
  };
  const onClick = (props: MunicipalityJSONProps) => {
    navigate({
      pathname: "/settlement",
      search: {
        region,
        municipality: getName(props),
      },
    });
  };
  return (
    municipalities && (
      <GeoJSONMap<MunicipalityJSONProps>
        mapJSON={municipalities}
        size={size}
        onClick={onClick}
        findVotes={findVotes}
        findInfo={findInfo}
        getName={getName}
      >
        {children}
      </GeoJSONMap>
    )
  );
};
