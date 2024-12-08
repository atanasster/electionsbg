import { MapLayout } from "@/layout/MapLayout";

import { SettlementsMap } from "./components/SettlementsMap";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { useMunicipalitydVotes } from "@/data/useMunicipalityVotes";
import { ProtocolSummary } from "./components/ProtocolSummary";
import { useRegions } from "@/data/useRegions";
import { useMunicipalities } from "@/data/useMunicipalities";
import { RegionInfo } from "@/data/dataTypes";
import { useMunicipalityStats } from "@/data/useMunicipalityStats";
import { PartyVotesTable } from "./components/PartyVotesTable";

export const SettlementsScreen = () => {
  const [searchParams] = useSearchParams();
  const regionCode = searchParams.get("region");
  const { findRegion } = useRegions();
  const { findMunicipality } = useMunicipalities();
  const { votesByMunicipality } = useMunicipalitydVotes();
  const { i18n } = useTranslation();
  const muniCode = searchParams.get("municipality");
  const { prevVotes, stats } = useMunicipalityStats(muniCode);
  if (!regionCode) {
    return null;
  }
  const region = findRegion(regionCode) as RegionInfo;

  if (!muniCode) {
    return null;
  }
  const municipality = findMunicipality(muniCode);
  if (!region || !municipality) {
    return null;
  }
  const municipalityVotes = votesByMunicipality(municipality.obshtina);
  return (
    <>
      <Title description="Interactive map  of a settlement in the elections in Bulgaria">
        {i18n.language === "bg"
          ? `${region.long_name || region.name} / ${municipality.name}`
          : `${region.long_name_en || region.name_en} / ${municipality.name_en}`}
      </Title>
      <ProtocolSummary
        protocol={municipalityVotes?.results.protocol}
        votes={municipalityVotes?.results.votes}
      />
      <MapLayout>
        {(size) => (
          <SettlementsMap
            municipality={municipality}
            region={region}
            size={size}
          />
        )}
      </MapLayout>
      <PartyVotesTable
        votes={municipalityVotes?.results.votes}
        stats={stats}
        prevElectionVotes={prevVotes?.results?.votes}
      />
    </>
  );
};
