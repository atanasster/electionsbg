import { useMemo } from "react";
import { MapCoordinates } from "@/layout/dataview/MapLayout";
import { useTooltip } from "@/ux/useTooltip";
import { useSettlementsMap } from "@/data/settlements/useSettlementsMap";
import { MunicipalityInfo } from "@/data/dataTypes";
import { useSettlementsInfo } from "@/data/settlements/useSettlements";
import { SettlementJSONProps } from "../maps/mapTypes";
import { useMapElements } from "../maps/useMapElements";
import { SVGMapContainer } from "../maps/SVGMapContainer";
import { LeafletMap } from "../maps/LeafletMap";
import {
  useSettlementsByMunicipality,
  useSettlementsByMunicipalityFor,
} from "@/data/settlements/useSettlementsByMunicipality";
import { useElectionContext } from "@/data/ElectionContext";
import { useTranslation } from "react-i18next";
import { usePartyInfo } from "@/data/parties/usePartyInfo";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { computeShifts } from "../maps/computeShifts";

// Diaspora continents (МИР 32). On settlement maps for these "municipalities"
// the rows are countries — pins are reserved for cities/capitals on regional
// maps, so suppress the pin fallback here just as MunicipalitiesMap does for
// the world view.
const DIASPORA_OBSHTINAS = new Set(["AF", "AS", "EU", "NA", "OC", "SA"]);

export const SettlementsMap: React.FC<{
  municipality: MunicipalityInfo;
  size: MapCoordinates;
}> = ({ size, municipality }) => {
  const votes = useSettlementsByMunicipality(municipality.obshtina);
  const { t, i18n } = useTranslation();
  const isBg = i18n.language?.startsWith("bg") ?? true;
  const { tooltip, ...tooltipEvents } = useTooltip();
  const mapGeo = useSettlementsMap(municipality.obshtina);
  const { findSettlement } = useSettlementsInfo();
  const { priorElections } = useElectionContext();
  const priorVotes = useSettlementsByMunicipalityFor(
    municipality.obshtina,
    priorElections?.name,
  );
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
        keyOf: (e) => e.ekatte,
      }),
    [votes, priorVotes, currentParties, priorParties],
  );

  const findInfo = (props: SettlementJSONProps) => findSettlement(props.ekatte);
  const findVotes = (props: SettlementJSONProps) =>
    votes?.find((v) => props.ekatte === v.ekatte);
  const findShift = (props: SettlementJSONProps) => shifts.get(props.ekatte);
  const hasAnyShift = useMemo(
    () =>
      Array.from(shifts.values()).some(
        (s) => s.deltaPp !== undefined && Math.abs(s.deltaPp) >= 0.25,
      ),
    [shifts],
  );

  const isDiaspora = DIASPORA_OBSHTINAS.has(municipality.obshtina);

  const { maps, labels, markers, bounds, scale } =
    useMapElements<SettlementJSONProps>({
      findInfo,
      findVotes,
      findShift,
      mapGeo,
      size,
      votes,
      // For diaspora continents the rows are countries (not cities), so the
      // pin fallback is suppressed — only shift arrows appear in the markers
      // slot. Regional Bulgarian maps keep their settlement pins.
      showMarkers: !isDiaspora,
      onClick: (props) => ({
        pathname: `/sections/${props.ekatte}`,
      }),
      // ⚠ THE THIRD MAP TO OPT IN, and the same measured defect: without a label
      // `FeatureMap`'s `!!ariaLabel && !!onClick` is false, so this map navigates on click and
      // cannot be reached from a keyboard. A município holds tens of settlements — the largest
      // is Столична at ~40 — so the tab order is usable, which is the whole test. The party
      // resolves through `canonical_parties.json`, the one corpus with both languages.
      featureLabel: (props, info, results) => {
        const name =
          (isBg ? info?.name : info?.name_en || info?.name) ?? props.ekatte;
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
