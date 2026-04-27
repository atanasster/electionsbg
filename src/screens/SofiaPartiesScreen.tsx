import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { localDate } from "@/data/utils";
import { useElectionContext } from "@/data/ElectionContext";
import { useRegionVotes } from "@/data/regions/useRegionVotes";
import { useSofiaStats } from "@/data/country/useSofiaStats";
import { PartyVotesTable } from "./components/PartyVotesTable";

export const SofiaPartiesScreen: FC = () => {
  const { selected } = useElectionContext();
  const { t } = useTranslation();
  const { votesSofia } = useRegionVotes();
  const { prevVotes, sofiaStats } = useSofiaStats();
  const { results } = votesSofia() || {};
  const sofiaName = t("sofia_city");
  const title = `${sofiaName} — ${t("parties")} — ${localDate(selected)}`;
  return (
    <>
      <Title description={t("all_parties_description")}>{title}</Title>
      <div className="w-full max-w-7xl mx-auto px-4 pb-12">
        <PartyVotesTable
          title={sofiaName}
          results={results}
          prevElection={prevVotes}
          stats={sofiaStats}
        />
      </div>
    </>
  );
};
