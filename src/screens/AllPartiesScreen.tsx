import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { useElectionContext } from "@/data/ElectionContext";
import { useRegionVotes } from "@/data/regions/useRegionVotes";
import { localDate } from "@/data/utils";
import { PartyVotesTable } from "./components/PartyVotesTable";

export const AllPartiesScreen: FC = () => {
  const { t } = useTranslation();
  const { selected, stats, priorElections } = useElectionContext();
  const { countryVotes } = useRegionVotes();
  const { results } = countryVotes();
  const title = `${t("all_parties")} — ${localDate(selected)}`;
  return (
    <>
      <Title description={t("all_parties_description")}>{title}</Title>
      <div className="w-full max-w-7xl mx-auto px-4 pb-12">
        <PartyVotesTable
          title={title}
          results={results}
          prevElection={priorElections}
          stats={stats}
        />
      </div>
    </>
  );
};
