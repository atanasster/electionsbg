import { MapCoordinates } from "@/layout/dataview/MapLayout";
import { SVGMapContainer } from "./maps/SVGMapContainer";
import { useRegionVotes } from "@/data/regions/useRegionVotes";
import { useTooltip } from "@/ux/useTooltip";
import { useRegions } from "@/data/regions/useRegions";
import { useMapElements } from "./maps/useMapElements";
import { RegionJSONProps } from "./maps/mapTypes";
import { useSofiaMap } from "@/data/country/useSofiaMap";
import { LeafletMap } from "./maps/LeafletMap";

export const SofiaMap: React.FC<{
  size: MapCoordinates;
  withNames: boolean;
}> = ({ size, withNames }) => {
  const { tooltip, ...tooltipEvents } = useTooltip();
  const mapGeo = useSofiaMap();
  const { countryRegions } = useRegionVotes();
  const votes = countryRegions();
  const { findRegion } = useRegions();
  const findInfo = (props: RegionJSONProps) => findRegion(props.nuts3);
  const findVotes = (props: RegionJSONProps) =>
    votes?.find((v) => props.nuts3 === v.key);

  const { maps, labels, markers, bounds, scale } =
    useMapElements<RegionJSONProps>({
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
