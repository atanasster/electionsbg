import { useTranslation } from "react-i18next";

import { MapLayout } from "@/layout/dataview/MapLayout";
import { Title } from "@/ux/Title";
import { useRegionVotes } from "@/data/regions/useRegionVotes";
import { ProtocolSummary } from "./components/ProtocolSummary";
import { PartyVotesTable } from "./components/PartyVotesTable";
import { SofiaMap } from "./components/SofiaMap";
import { useSofiaStats } from "@/data/country/useSofiaStats";
import { DataViewContainer } from "@/layout/dataview/DataViewContainer";
import { useDataViewContext } from "@/layout/dataview/DataViewContext";
import { MultiHistoryChart } from "./components/charts/MultiHistoryChart";

export const SofiaScreen = () => {
  const { t } = useTranslation();
  const { view } = useDataViewContext();
  const { votesSofia } = useRegionVotes();
  const { prevVotes, sofiaStats } = useSofiaStats();
  const results = votesSofia();
  const title = t("sofia_city");
  return (
    <>
      <Title description="Interactive country map  of the elections in Bulgaria">
        {title}
      </Title>
      <ProtocolSummary protocol={results?.protocol} votes={results?.votes} />
      <DataViewContainer title={title}>
        {view === "map" && (
          <MapLayout>
            {(size, withNames) => (
              <SofiaMap size={size} withNames={withNames} />
            )}
          </MapLayout>
        )}
        {view === "table" && (
          <PartyVotesTable
            votes={results?.votes}
            prevElectionVotes={prevVotes?.results?.votes}
            stats={sofiaStats}
          />
        )}
        {view === "chart" && sofiaStats && (
          <MultiHistoryChart stats={sofiaStats} />
        )}
      </DataViewContainer>
    </>
  );
};
