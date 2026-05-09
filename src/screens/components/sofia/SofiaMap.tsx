import { useMemo } from "react";
import { MapCoordinates } from "@/layout/dataview/MapLayout";
import { SVGMapContainer } from "../maps/SVGMapContainer";
import {
  useRegionVotes,
  useRegionVotesFor,
} from "@/data/regions/useRegionVotes";
import { useTooltip } from "@/ux/useTooltip";
import { useRegions } from "@/data/regions/useRegions";
import { useMapElements } from "../maps/useMapElements";
import { RegionJSONProps } from "../maps/mapTypes";
import { useSofiaMap } from "@/data/country/useSofiaMap";
import { LeafletMap } from "../maps/LeafletMap";
import { useElectionContext } from "@/data/ElectionContext";
import { usePartyInfo } from "@/data/parties/usePartyInfo";
import { computeShifts } from "../maps/computeShifts";

export const SofiaMap: React.FC<{
  size: MapCoordinates;
}> = ({ size }) => {
  const { tooltip, ...tooltipEvents } = useTooltip();
  const mapGeo = useSofiaMap();
  const { sofiaRegions, countryRegions } = useRegionVotes();
  const votes = countryRegions();
  const sofiaVotes = sofiaRegions();
  const { findRegion } = useRegions();
  const { priorElections } = useElectionContext();
  const priorVotes = useRegionVotesFor(priorElections?.name);
  const { parties: currentParties } = usePartyInfo();
  const { parties: priorParties } = usePartyInfo(priorElections?.name);

  const shifts = useMemo(
    () =>
      computeShifts({
        current: sofiaVotes,
        prior: priorVotes,
        currentParties: currentParties ?? undefined,
        priorParties: priorParties ?? undefined,
        keyOf: (e) => e.key,
      }),
    [sofiaVotes, priorVotes, currentParties, priorParties],
  );

  const findInfo = (props: RegionJSONProps) => findRegion(props.nuts3);
  const findVotes = (props: RegionJSONProps) =>
    votes?.find((v) => props.nuts3 === v.key);
  const findShift = (props: RegionJSONProps) => shifts.get(props.nuts3);
  const hasAnyShift = useMemo(
    () =>
      Array.from(shifts.values()).some(
        (s) => s.deltaPp !== undefined && Math.abs(s.deltaPp) >= 0.25,
      ),
    [shifts],
  );

  const { maps, labels, markers, bounds, scale } =
    useMapElements<RegionJSONProps>({
      findInfo,
      findVotes,
      findShift,
      mapGeo,
      size,
      votes,
      onClick: (props) => ({
        pathname: `/municipality/${props.nuts3}`,
      }),
      ...tooltipEvents,
    });

  return (
    <div>
      <div className="relative">
        <LeafletMap size={size} bounds={bounds} scale={scale} />
        <SVGMapContainer size={size} supportsShiftArrows={hasAnyShift}>
          {maps}
          {markers}
          {labels}
        </SVGMapContainer>
      </div>
      {tooltip}
    </div>
  );
};
