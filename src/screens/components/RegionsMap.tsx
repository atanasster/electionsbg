import { RegionGeoJSON, RegionJSONProps } from "@/data/mapTypes";
import { useRegionVotes } from "@/data/useRegionVotes";
import { useRegions } from "@/data/useRegions";

import { MapCoordinates } from "@/layout/MapLayout";
import { GeoJSONMap } from "./maps/GeoJSONMap";
import { useNavigateParams } from "@/ux/useNavigateParams";

export const RegionsMap: React.FC<
  React.PropsWithChildren<{ regions: RegionGeoJSON; size: MapCoordinates }>
> = ({ regions, size, children }) => {
  const navigate = useNavigateParams();
  const { findRegion } = useRegions();
  const { votesByRegion } = useRegionVotes();

  const findInfo = (props: RegionJSONProps) => {
    return findRegion(getName(props));
  };
  const findVotes = (props: RegionJSONProps) => {
    return votesByRegion(getName(props))?.results.votes;
  };
  const getName = (props: RegionJSONProps) => {
    return props.nuts3;
  };
  const onClick = (props: RegionJSONProps) => {
    navigate({
      pathname: "/municipality",
      search: {
        region: getName(props),
      },
    });
  };
  return (
    <GeoJSONMap<RegionJSONProps>
      mapJSON={regions}
      size={size}
      onClick={onClick}
      findVotes={findVotes}
      findInfo={findInfo}
      getName={getName}
    >
      {children}
    </GeoJSONMap>
  );
};
