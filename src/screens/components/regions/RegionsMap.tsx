import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useRegionsMap } from "@/data/regions/useRegionsMap";
import {
  useRegionVotes,
  useRegionVotesFor,
} from "@/data/regions/useRegionVotes";
import { useTooltip } from "@/ux/useTooltip";
import { useRegions } from "@/data/regions/useRegions";
import { RegionJSONProps } from "../maps/mapTypes";
import { useMapElements } from "../maps/useMapElements";
import { SVGMapContainer } from "../maps/SVGMapContainer";
import { MapCoordinates } from "@/layout/dataview/MapLayout";
import { WorldLink } from "./WorldLink";
import { SofiaCity } from "./SofiaCity";
import { LeafletMap } from "../maps/LeafletMap";
import { useElectionContext } from "@/data/ElectionContext";
import { usePartyInfo } from "@/data/parties/usePartyInfo";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { computeShifts } from "../maps/computeShifts";

export const RegionsMap: React.FC<{
  size: MapCoordinates;
}> = ({ size }) => {
  const { t, i18n } = useTranslation();
  const isBg = i18n.language?.startsWith("bg") ?? true;
  const { tooltip, ...tooltipEvents } = useTooltip();
  const mapGeo = useRegionsMap();
  const { countryRegions } = useRegionVotes();
  const votes = countryRegions();
  const { findRegion } = useRegions();
  const { priorElections } = useElectionContext();
  const priorVotes = useRegionVotesFor(priorElections?.name);
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
        keyOf: (e) => e.key,
      }),
    [votes, priorVotes, currentParties, priorParties],
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
      // ⚠ 28 OBLASTS — small enough for a usable tab order, which is the whole opt-in test
      // (`FeatureMap`'s own comment; the section maps with thousands of paths stay out). Without
      // a label `FeatureMap`'s `!!ariaLabel && !!onClick` is false and this map is MOUSE-ONLY:
      // it navigates on click and cannot be reached from a keyboard at all.
      //
      // The label names the place AND its leading party, because "Пловдив" alone tells a screen
      // reader nothing the surrounding list does not already say — the map's content IS which
      // party led where.
      featureLabel: (props, info, results) => {
        // The place's own name in the reader's language — `name_en` is typed as required and
        // populated, so `||` rather than `??`: an EMPTY string must fall through to the
        // Bulgarian name rather than to the raw code.
        const name =
          (isBg ? info?.name : info?.name_en || info?.name) ?? props.nuts3;
        const lead = topVotesParty(results?.results.votes);
        // ⚠ RESOLVED FROM THE CANONICAL CORPUS, NOT FROM THE BALLOT RECORD (§5.3).
        // `cik_parties.json` carries `nickName` and — measured, 0 of 25 rows for this cycle —
        // NO English form at all, so „Blagoevgrad — ПрБ leads" was the first rendering: a
        // Cyrillic party name on an English page, at a 200. `canonical_parties.json` is the
        // one corpus that holds both languages, and `displayNameFor` is the app's one reader
        // of it. It falls back to the ballot nickname when a party does not resolve, which
        // keeps the label's subject rather than blanking it.
        const party =
          (lead?.nickName ? displayNameFor(lead.nickName) : undefined) ??
          lead?.nickName ??
          "";
        return party ? t("map_region_aria_leader", { name, party }) : name;
      },
      ...tooltipEvents,
    });

  return (
    <>
      <div className="flex w-full">
        <div className="relative">
          <LeafletMap size={size} bounds={bounds} scale={scale} />
          <SVGMapContainer size={size} supportsShiftArrows={hasAnyShift}>
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
