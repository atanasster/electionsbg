import { useTranslation } from "react-i18next";

import { MapLayout } from "@/layout/MapLayout";
import { useRegionsMap } from "@/data/useRegionsMap";
import { RegionsMap } from "./components/RegionsMap";
import { Title } from "@/ux/Title";
import { useRegionVotes } from "@/data/useRegionVotes";
import { ProtocolSummary } from "./components/ProtocolSummary";
import { useMemo } from "react";
import { useCountryStats } from "@/data/useCountryVotesStats";
import { WorldLink } from "./components/WorldLink";
import { useElectionContext } from "@/data/ElectionContext";
import { PartyVotesTable } from "./components/PartyVotesTable";

export const RegionsScreen = () => {
  const { t } = useTranslation();
  const { regions } = useRegionsMap();
  const { countryVotes } = useRegionVotes();
  const { prevVotes } = useCountryStats();
  const { stats } = useElectionContext();
  const results = useMemo(() => countryVotes(), [countryVotes]);

  return (
    <>
      <Title description="Interactive country map  of the elections in Bulgaria">
        {t("general_results")}
      </Title>
      <ProtocolSummary protocol={results.protocol} votes={results.votes} />

      {regions && (
        <div className="flex flex-row w-full">
          <MapLayout>
            {(size) => (
              <RegionsMap regions={regions} size={size}>
                <WorldLink size={size} />
              </RegionsMap>
            )}
          </MapLayout>
        </div>
      )}
      <PartyVotesTable
        votes={results.votes}
        prevElectionVotes={prevVotes}
        stats={stats}
      />
    </>
  );
};
