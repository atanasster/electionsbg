import { MapLayout } from "@/layout/MapLayout";

import { MunicipalitiesMap } from "./components/MunicipalitiesMap";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ProtocolSummary } from "./components/ProtocolSummary";
import { useRegionVotes } from "@/data/useRegionVotes";
import { Title } from "@/ux/Title";
import { useRegions } from "@/data/useRegions";
import { useRegionStats } from "@/data/useRegionStats";
import { PartyVotesTable } from "./components/PartyVotesTable";

export const MunicipalitiesScreen = () => {
  const [searchParams] = useSearchParams();
  const { findRegion } = useRegions();
  const { votesByRegion } = useRegionVotes();
  const { i18n } = useTranslation();
  const region = searchParams.get("region");
  const { prevVotes, stats } = useRegionStats(region);
  if (!region) {
    return null;
  }
  const info = findRegion(region);
  const regionVotes = (info && votesByRegion(info.oblast)) || null;

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

      <MapLayout>
        {(size, withNames) => (
          <MunicipalitiesMap
            region={region}
            size={size}
            withNames={withNames}
          />
        )}
      </MapLayout>
      <PartyVotesTable
        votes={regionVotes?.results.votes}
        prevElectionVotes={prevVotes?.results?.votes}
        stats={stats}
      />
    </>
  );
};
