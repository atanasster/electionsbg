import { ElectionVotes } from "@/data/dataTypes";
import { useElectionInfo } from "@/data/ElectionsContext";
import { FC } from "react";

export const PartyVotes: FC<{ votes: ElectionVotes }> = ({ votes }) => {
  const { findParty } = useElectionInfo();
  return (
    <table className="w-full border border-collapse table-auto">
      <thead>
        <tr className="text-base font-bold text-left bg-gray-5">
          <th className="px-4 py-2 border-b-2 border-blue-500">#</th>
          <th className="px-4 py-2 border-b-2 border-blue-500">Party</th>
          <th className="px-4 py-2 border-b-2 border-blue-500">Machine</th>
          <th className="px-4 py-2 border-b-2 border-blue-500">Paper</th>
          <th className="px-4 py-2 border-b-2 border-blue-500">Total Votes</th>
        </tr>
      </thead>
      <tbody className="text-sm text-left font-normal text-gray-700">
        {votes.votes.map((vote) => {
          const party = findParty(vote.key);
          return (
            <tr
              className="py-10 border-b border-gray-200 hover:bg-gray-100"
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
