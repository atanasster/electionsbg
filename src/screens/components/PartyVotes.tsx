import { ElectionVotes } from "@/data/dataTypes";
import { useElectionInfo } from "@/data/ElectionsContext";
import { FC } from "react";
import { useTranslation } from "react-i18next";

export const PartyVotes: FC<{ votes: ElectionVotes }> = ({ votes }) => {
  const { findParty } = useElectionInfo();
  const { t } = useTranslation();
  return (
    <table className="w-full border border-collapse table-auto text-muted-foreground">
      <thead>
        <tr className="font-bold text-left bg-gray-5">
          <th className="px-4 py-2 border-b-2">#</th>
          <th className="px-4 py-2 border-b-2">{t("party")}</th>
          <th className="px-4 py-2 border-b-2">{t("machine_votes")}</th>
          <th className="px-4 py-2 border-b-2">{t("paper_votes")}</th>
          <th className="px-4 py-2 border-b-2">{t("total_votes")}</th>
        </tr>
      </thead>
      <tbody className="text-sm text-left font-normal">
        {votes.votes.map((vote) => {
          const party = findParty(vote.key);
          return (
            <tr
              className="py-10 border-b border-gray-200 hover:bg-secondary"
              key={vote.key}
            >
              <td className="px-4 py-2">{vote.key}</td>
              <td className="px-4 py-2">{party?.name || "unknown party"}</td>
              <td className="px-4 py-2">{vote.machineVotes}</td>
              <td className="px-4 py-2">{vote.paperVotes}</td>
              <td className="px-4 py-2">{vote.totalVotes}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
};
