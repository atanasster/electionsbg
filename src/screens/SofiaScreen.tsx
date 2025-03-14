import { useTranslation } from "react-i18next";

import { MapLayout } from "@/layout/dataview/MapLayout";
import { Title } from "@/ux/Title";
import { useRegionVotes } from "@/data/regions/useRegionVotes";
import { ProtocolSummary } from "./components/protocols/ProtocolSummary";
import { PartyVotesTable } from "./components/PartyVotesTable";
import { SofiaMap } from "./components/sofia/SofiaMap";
import { useSofiaStats } from "@/data/country/useSofiaStats";
import { DataViewContainer } from "@/layout/dataview/DataViewContainer";
import { MultiHistoryChart } from "./components/charts/MultiHistoryChart";
import { SofiaAreasTable } from "./components/sofia/SofiaAreasTable";
import { PreferencesSofia } from "./components/preferences/PreferencesSofia";
import { PartyRecountTable } from "./components/PartyRecountTable";
import { PartySuemgTable } from "./components/PartySuemgTable";

export const SofiaScreen = () => {
  const { t } = useTranslation();
  const { votesSofia } = useRegionVotes();
  const { prevVotes, sofiaStats } = useSofiaStats();
  const { results, original } = votesSofia() || {};
  const title = t("sofia_city");
  return (
    <>
      <Title description="Interactive country map  of the elections in Bulgaria">
        {title}
      </Title>
      <ProtocolSummary results={results} original={original} />
      <DataViewContainer title={title}>
        {(view) => {
          if (view === "map")
            return (
              <MapLayout>
                {(size, withNames) => (
                  <SofiaMap size={size} withNames={withNames} />
                )}
              </MapLayout>
            );
          if (view === "table") return <SofiaAreasTable />;
          if (view === "parties")
            return (
              <PartyVotesTable
                title={title}
                results={results}
                prevElection={prevVotes}
                stats={sofiaStats}
              />
            );
          if (view === "recount")
            return (
              <PartyRecountTable title={title} votes={{ results, original }} />
            );
          if (view === "suemg")
            return <PartySuemgTable title={title} results={results} />;
          if (view === "pref.") return <PreferencesSofia />;
          if (view === "chart" && sofiaStats)
            return <MultiHistoryChart stats={sofiaStats} />;
        }}
      </DataViewContainer>
    </>
  );
};
