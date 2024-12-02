import { MapLayout } from "@/layout/MapLayout";

import { MunicipalitiesMap } from "./components/MunicipalitiesMap";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ProtocolSummary } from "./components/ProtocolSummary";
import { useRegionVotes } from "@/data/useRegionVotes";
import { Title } from "@/ux/Title";
import { useRegions } from "@/data/useRegions";
import { useMunicipalitiesMap } from "@/data/useMunicipalitiesMap";
import { TopParties } from "./components/TopParties";
import { usePrevElectionRegionVotes } from "@/data/usePrevElectionRegionVotes";

export const MunicipalitiesScreen = () => {
  const [searchParams] = useSearchParams();
  const { findRegion } = useRegions();
  const { municipalities } = useMunicipalitiesMap();
  const { votesByRegion } = useRegionVotes();
  const { prevVotesByRegion } = usePrevElectionRegionVotes();
  const { i18n } = useTranslation();
  const region = searchParams.get("region");
  if (!region) {
    return null;
  }
  const info = findRegion(region);
  const regionVotes = (info && votesByRegion(info.oblast)) || null;
  const prevRegionVotes = (info && prevVotesByRegion(info.oblast)) || null;

  return (
    <>
      <Title description="Interactive map  of a municipality in the elections in Bulgaria">
        {(i18n.language === "bg"
          ? info?.long_name || info?.name
          : info?.long_name_en || info?.name_en) || ""}
      </Title>
      <ProtocolSummary
        protocol={regionVotes?.results.protocol}
        votes={regionVotes?.results.votes}
      />
      {municipalities && (
        <MapLayout>
          {(size) => (
            <MunicipalitiesMap
              municipalities={municipalities}
              region={region}
              size={size}
            />
          )}
        </MapLayout>
      )}
      <TopParties
        votes={regionVotes?.results.votes}
        prevElectionVotes={prevRegionVotes}
      />
    </>
  );
};
