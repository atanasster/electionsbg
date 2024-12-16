import { MapLayout } from "@/layout/MapLayout";
import { SettlementsMap } from "./components/SettlementsMap";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { useMunicipalityVotes } from "@/data/useMunicipalityVotes";
import { ProtocolSummary } from "./components/ProtocolSummary";
import { useRegions } from "@/data/useRegions";
import { useMunicipalities } from "@/data/useMunicipalities";
import { useMunicipalityStats } from "@/data/useMunicipalityStats";
import { PartyVotesTable } from "./components/PartyVotesTable";

export const SettlementsScreen = () => {
  const [searchParams] = useSearchParams();
  const { findRegion } = useRegions();
  const muniCode = searchParams.get("municipality");
  const { municipality } = useMunicipalityVotes(muniCode);
  const { i18n } = useTranslation();
  const { findMunicipality } = useMunicipalities();
  const info = findMunicipality(muniCode);
  const { prevVotes, stats } = useMunicipalityStats(muniCode);
  if (!muniCode) {
    return null;
  }
  const region = findRegion(municipality?.oblast);
  if (!region || !municipality) {
    return null;
  }
  return (
    <>
      <Title description="Interactive map  of a settlement in the elections in Bulgaria">
        {i18n.language === "bg"
          ? `${region.long_name || region.name} / ${info?.name}`
          : `${region.long_name_en || region.name_en} / ${info?.name_en}`}
      </Title>
      <ProtocolSummary
        protocol={municipality?.results.protocol}
        votes={municipality?.results.votes}
      />
      {info && (
        <MapLayout>
          {(size, withNames) => (
            <SettlementsMap
              municipality={info}
              size={size}
              withNames={withNames}
            />
          )}
        </MapLayout>
      )}
      <PartyVotesTable
        votes={municipality?.results.votes}
        stats={stats}
        prevElectionVotes={prevVotes?.results?.votes}
      />
    </>
  );
};
