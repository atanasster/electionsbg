import { MapCoordinates } from "@/layout/MapLayout";
import { SVGMapContainer } from "./maps/SVGMapContainer";
import { useRegionsMap } from "@/data/useRegionsMap";
import { useRegionVotes } from "@/data/useRegionVotes";
import { useTooltip } from "@/ux/useTooltip";
import { useRegions } from "@/data/useRegions";
import { WorldLink } from "./WorldLink";
import { useMapElements } from "./maps/useMapElements";
import { RegionJSONProps } from "./maps/mapTypes";

export const RegionsMap: React.FC<{
  size: MapCoordinates;
  withNames: boolean;
}> = ({ size, withNames }) => {
  const { tooltip, ...tooltipEvents } = useTooltip();
  const { regions: mapGeo } = useRegionsMap();
  const { countryRegions } = useRegionVotes();
  const votes = countryRegions();
  const { findRegion } = useRegions();
  const findInfo = (props: RegionJSONProps) => findRegion(props.nuts3);
  const findVotes = (props: RegionJSONProps) =>
    votes?.find((v) => props.nuts3 === v.key);

  const { maps, labels, markers } = useMapElements<RegionJSONProps>({
    findInfo,
    findVotes,
    mapGeo,
    size,
    votes,
    withNames,
    onClick: (props) => ({
      pathname: `/municipality/${props.nuts3}`,
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
        <WorldLink size={size} />
      </div>
      {tooltip}
    </div>
  );
};
