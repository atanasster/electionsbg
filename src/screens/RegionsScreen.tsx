import { useTranslation } from "react-i18next";

import { MapLayout } from "@/layout/MapLayout";
import { RegionsMap } from "./components/RegionsMap";
import { Title } from "@/ux/Title";
import { useRegionVotes } from "@/data/regions/useRegionVotes";
import { ProtocolSummary } from "./components/ProtocolSummary";
import { useCountryStats } from "@/data/country/useCountryVotesStats";
import { useElectionContext } from "@/data/ElectionContext";
import { PartyVotesTable } from "./components/PartyVotesTable";

export const RegionsScreen = () => {
  const { t } = useTranslation();
  const { countryVotes } = useRegionVotes();
  const { prevVotes } = useCountryStats();
  const { stats } = useElectionContext();
  const results = countryVotes();
  return (
    <>
      <Title description="Interactive country map  of the elections in Bulgaria">
        {t("general_results")}
      </Title>
      <ProtocolSummary protocol={results.protocol} votes={results.votes} />

      <div className="flex flex-row w-full">
        <MapLayout>
          {(size, withNames) => (
            <RegionsMap size={size} withNames={withNames} />
          )}
        </MapLayout>
      </div>
      <PartyVotesTable
        votes={results.votes}
        prevElectionVotes={prevVotes}
        stats={stats}
      />
    </>
  );
};
