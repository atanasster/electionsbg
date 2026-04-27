import { FC } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { useSectionsVotes } from "@/data/sections/useSectionsVotes";
import { useSectionStats } from "@/data/sections/useSectionStats";
import { localDate } from "@/data/utils";
import { useElectionContext } from "@/data/ElectionContext";
import { PartyVotesTable } from "./components/PartyVotesTable";

export const SectionPartiesScreen: FC = () => {
  const { id: sectionCode } = useParams();
  const section = useSectionsVotes(sectionCode);
  const { prevVotes, stats } = useSectionStats(sectionCode);
  const { selected } = useElectionContext();
  const { t } = useTranslation();
  if (!sectionCode) return null;
  const name = `${t("section")} ${sectionCode}`;
  const title = `${name} — ${t("parties")} — ${localDate(selected)}`;
  return (
    <>
      <Title description={t("all_parties_description")}>{title}</Title>
      <div className="w-full max-w-7xl mx-auto px-4 pb-12">
        <PartyVotesTable
          title={title}
          results={section?.results}
          stats={stats}
          prevElection={prevVotes}
        />
      </div>
    </>
  );
};
