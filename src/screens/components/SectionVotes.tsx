import { useElectionInfo } from "@/data/ElectionsContext";
import { useElectionVotes } from "@/data/VotesContext";
import { FC } from "react";

export const SectionVotes: FC<{ section: string }> = ({ section }) => {
  const { findSectionVotes } = useElectionVotes();
  const { parties } = useElectionInfo();
  const votes = findSectionVotes(section);
  if (!votes) {
    return null;
  }
  return (
    <table className="w-full border border-collapse table-auto">
      <thead>
        <tr className="text-base font-bold text-left bg-gray-5">
          <th className="px-4 py-3 border-b-2 border-blue-500">#</th>
          <th className="px-4 py-3 border-b-2 border-blue-500">Party</th>
          <th className="px-4 py-3 border-b-2 border-blue-500">Votes</th>
        </tr>
      </thead>
      <tbody className="text-sm text-left font-normal text-gray-700">
        {parties.map((party) => {
          return (
            <tr
              className="py-10 border-b border-gray-200 hover:bg-gray-100"
              key={party.number}
            >
              <td className="px-4 py-4">{party.number}</td>
              <td className="px-4 py-4">{party.party}</td>
              <td className="px-4 py-4">{votes[party.number].totalVotes}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
};
