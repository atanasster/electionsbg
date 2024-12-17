import { useTranslation } from "react-i18next";

import { MapLayout } from "@/layout/MapLayout";
import { Title } from "@/ux/Title";
import { useRegionVotes } from "@/data/useRegionVotes";
import { ProtocolSummary } from "./components/ProtocolSummary";
import { PartyVotesTable } from "./components/PartyVotesTable";
import { SofiaMap } from "./components/SofiaMap";
import { useSofiaStats } from "@/data/useSofiaStats";

export const SofiaScreen = () => {
  const { t } = useTranslation();
  const { votesSofia } = useRegionVotes();
  const { prevVotes, sofiaStats } = useSofiaStats();
  const results = votesSofia();
  return (
    <>
      <Title description="Interactive country map  of the elections in Bulgaria">
        {t("general_results")}
      </Title>
      <ProtocolSummary protocol={results?.protocol} votes={results?.votes} />

      <div className="flex flex-row w-full">
        <MapLayout>
          {(size, withNames) => <SofiaMap size={size} withNames={withNames} />}
        </MapLayout>
      </div>
      <PartyVotesTable
        votes={results?.votes}
        prevElectionVotes={prevVotes?.results?.votes}
        stats={sofiaStats}
      />
    </>
  );
};
