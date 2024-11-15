import { MapLayout } from "@/layout/MapLayout";

import { settlements } from "./data/json_types";
import { SettlementsMap } from "./components/SettlementsMap";
import { useSearchParams } from "react-router-dom";
import { useSettlementsInfo } from "@/data/SettlementsContext";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { useAggregatedVotes } from "@/data/AggregatedVotesHook";
import { ProtocolSummary } from "./components/ProtocolSummary";

export const SettlementsScreen = () => {
  const [searchParams] = useSearchParams();
  const regionCode = searchParams.get("region");
  const { findRegion, findMunicipality } = useSettlementsInfo();
  const { votesByMunicipality } = useAggregatedVotes();
  const { i18n } = useTranslation();
  if (!regionCode) {
    return null;
  }
  const region = findRegion(regionCode);
  const muniCode = searchParams.get("municipality");
  if (!muniCode) {
    return null;
  }
  const municipality = findMunicipality(muniCode);
  if (!region || !municipality) {
    return null;
  }
  const municipalityVotes = votesByMunicipality(
    region.oblast,
    municipality.obshtina,
  );
  return (
    <>
      <Title>
        {i18n.language === "bg"
          ? `${region.name} / ${municipality.name}`
          : `${region.name_en} / ${municipality.name_en}`}
      </Title>
      {municipalityVotes && municipalityVotes.results.protocol && (
        <ProtocolSummary
          protocol={municipalityVotes.results.protocol}
          votes={municipalityVotes.results.votes}
        />
      )}
      <MapLayout>
        {(size) => (
          <SettlementsMap
            settlements={settlements}
            municipality={municipality}
            region={region}
            size={size}
          />
        )}
      </MapLayout>
    </>
  );
};
