import { useRegionsMap } from "@/data/regions/useRegionsMap";
import { useRegionVotes } from "@/data/regions/useRegionVotes";
import { useTooltip } from "@/ux/useTooltip";
import { useRegions } from "@/data/regions/useRegions";
import { RegionJSONProps } from "../maps/mapTypes";
import { useMapElements } from "../maps/useMapElements";
import { SVGMapContainer } from "../maps/SVGMapContainer";
import { MapCoordinates } from "@/layout/dataview/MapLayout";
import { WorldLink } from "./WorldLink";
import { SofiaCity } from "./SofiaCity";
import { LeafletMap } from "../maps/LeafletMap";

export const RegionsMap: React.FC<{
  size: MapCoordinates;
}> = ({ size }) => {
  const { tooltip, ...tooltipEvents } = useTooltip();
  const mapGeo = useRegionsMap();
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
      onClick: (props) => ({
        pathname: `/municipality/${props.nuts3}`,
      }),
      ...tooltipEvents,
    });

  return (
    <>
      <div className="flex w-full">
        <div className="relative">
          <LeafletMap size={size} bounds={bounds} scale={scale} />
          <SVGMapContainer size={size}>
            {maps}
            {markers}
            {labels}
          </SVGMapContainer>
          <SofiaCity size={size} />
          <WorldLink size={size} />
        </div>
        {tooltip}
      </div>
    </>
  );
};
