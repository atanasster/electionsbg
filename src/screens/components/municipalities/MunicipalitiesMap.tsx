import { useMemo } from "react";
import { MapCoordinates } from "@/layout/dataview/MapLayout";
import { useTooltip } from "@/ux/useTooltip";
import { useMunicipalitiesMap } from "@/data/municipalities/useMunicipalitiesMap";
import { useMunicipalities } from "@/data/municipalities/useMunicipalities";
import { MunicipalityJSONProps } from "../maps/mapTypes";
import { useTranslation } from "react-i18next";
import { useMapElements } from "../maps/useMapElements";
import { SVGMapContainer } from "../maps/SVGMapContainer";
import { LeafletMap } from "../maps/LeafletMap";
import {
  useMunicipalitiesByRegion,
  useMunicipalitiesByRegionFor,
} from "@/data/municipalities/useMunicipalitiesByRegion";
import { useElectionContext } from "@/data/ElectionContext";
import { usePartyInfo } from "@/data/parties/usePartyInfo";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { computeShifts } from "../maps/computeShifts";

export const MunicipalitiesMap: React.FC<{
  region: string;
  size: MapCoordinates;
}> = ({ size, region }) => {
  const { t, i18n } = useTranslation();
  const isBg = i18n.language?.startsWith("bg") ?? true;
  const { tooltip, ...tooltipEvents } = useTooltip();
  const votes = useMunicipalitiesByRegion(region);
  const mapGeo = useMunicipalitiesMap(region);
  const { priorElections } = useElectionContext();
  const priorVotes = useMunicipalitiesByRegionFor(region, priorElections?.name);
  const { parties: currentParties, topVotesParty } = usePartyInfo();
  const { displayNameFor } = useCanonicalParties();
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
      // ⚠ THE SAME OPT-IN THE COUNTRY MAP TAKES, and for the same measured reason: without a
      // label `FeatureMap`'s `!!ariaLabel && !!onClick` is false and this map navigates on click
      // while being unreachable from a keyboard. A region holds at most a few dozen общини — and
      // МИР 32 a handful of continents — so the tab order is usable, which is the whole test.
      // The party resolves through `canonical_parties.json`, the one corpus with both languages;
      // `cik_parties.json` carries no English form at all.
      featureLabel: (props, info, results) => {
        const name =
          (isBg ? info?.name : info?.name_en || info?.name) ?? props.nuts4;
        const lead = topVotesParty(results?.results.votes);
        const party =
          (lead?.nickName ? displayNameFor(lead.nickName) : undefined) ??
          lead?.nickName ??
          "";
        return party ? t("map_region_aria_leader", { name, party }) : name;
      },
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
