import { FC } from "react";
import { Votes } from "@/data/dataTypes";
import { useElectionInfo } from "@/data/ElectionsContext";

export const PartyVotesXS: FC<{ votes?: Votes[] }> = ({ votes }) => {
  const { findParty } = useElectionInfo();
  return votes ? (
    <table className="w-full border border-collapse table-auto">
      <thead>
        <tr className="text-base font-bold bg-gray-5 py-3">
          <th className="border-b-2 text-center border-blue-500">#</th>
          <th className="border-b-2 text-left border-blue-500">Party</th>
          <th className="border-b-2 text-center border-blue-500">Votes</th>
        </tr>
      </thead>
      <tbody className="text-sm text-left font-normal text-gray-700">
        {votes
          .sort((a, b) => b.totalVotes - a.totalVotes)
          .slice(0, 5)
          .map((v) => {
            const party = findParty(v.key);
            return (
              <tr
                className="border-b border-gray-200 hover:bg-gray-100"
                key={v.key}
              >
                <td className="px-2 text-right">{v.key}</td>
                <td className="px-2">{party?.party || "unknown party"}</td>
                <td className="px-2 text-right">{v.totalVotes}</td>
              </tr>
            );
          })}
      </tbody>
    </table>
  ) : null;
};
