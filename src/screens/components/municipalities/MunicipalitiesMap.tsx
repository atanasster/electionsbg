import { useMemo } from "react";
import { MapCoordinates } from "@/layout/dataview/MapLayout";
import { useTooltip } from "@/ux/useTooltip";
import { useMunicipalitiesMap } from "@/data/municipalities/useMunicipalitiesMap";
import { useMunicipalities } from "@/data/municipalities/useMunicipalities";
import { MunicipalityJSONProps } from "../maps/mapTypes";
import { useMapElements } from "../maps/useMapElements";
import { SVGMapContainer } from "../maps/SVGMapContainer";
import { LeafletMap } from "../maps/LeafletMap";
import {
  useMunicipalitiesByRegion,
  useMunicipalitiesByRegionFor,
} from "@/data/municipalities/useMunicipalitiesByRegion";
import { useElectionContext } from "@/data/ElectionContext";
import { usePartyInfo } from "@/data/parties/usePartyInfo";
import { computeShifts } from "../maps/computeShifts";

export const MunicipalitiesMap: React.FC<{
  region: string;
  size: MapCoordinates;
}> = ({ size, region }) => {
  const { tooltip, ...tooltipEvents } = useTooltip();
  const votes = useMunicipalitiesByRegion(region);
  const mapGeo = useMunicipalitiesMap(region);
  const { priorElections } = useElectionContext();
  const priorVotes = useMunicipalitiesByRegionFor(region, priorElections?.name);
  const { parties: currentParties } = usePartyInfo();
  const { parties: priorParties } = usePartyInfo(priorElections?.name);

  const shifts = useMemo(
    () =>
      computeShifts({
        current: votes,
        prior: priorVotes,
        currentParties: currentParties ?? undefined,
        priorParties: priorParties ?? undefined,
        keyOf: (e) => e.obshtina,
      }),
    [votes, priorVotes, currentParties, priorParties],
  );

  const { findMunicipality } = useMunicipalities();
  const findInfo = (props: MunicipalityJSONProps) =>
    findMunicipality(props.nuts4);
  const findVotes = (props: MunicipalityJSONProps) =>
    votes?.find((v) => props.nuts4 === v.obshtina);
  const findShift = (props: MunicipalityJSONProps) => shifts.get(props.nuts4);
  const hasAnyShift = useMemo(
    () =>
      Array.from(shifts.values()).some(
        (s) => s.deltaPp !== undefined && Math.abs(s.deltaPp) >= 0.25,
      ),
    [shifts],
  );

  const { maps, labels, markers, bounds, scale } =
    useMapElements<MunicipalityJSONProps>({
      findInfo,
      findVotes,
      findShift,
      mapGeo,
      size,
      votes,
      // МИР 32 is the abroad district — the "municipalities" are continents.
      // Pin markers are reserved for capital-city locations on regional maps,
      // so suppress the fallback at continent scale (shift arrows still render).
      showMarkers: region !== "32",
      onClick: (props) => ({
        pathname: `/settlement/${props.nuts4}`,
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
