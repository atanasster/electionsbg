import { FC } from "react";
import { Votes } from "@/data/dataTypes";
import { useElectionInfo } from "@/data/ElectionsContext";

export const PartyVotesXS: FC<{ votes?: Votes[] }> = ({ votes }) => {
  const { findParty } = useElectionInfo();
  if (!votes || votes.length === 0) {
    return null;
  }

  const totalVotes = votes.reduce(
    (acc: number, v: Votes) => acc + v.totalVotes,
    0,
  );
  const formatPct = (n: number) => {
    return `${(Math.round(n * 1000) / 1000).toFixed(3)}%`;
  };
  return (
    <table className="w-full border border-collapse table-auto">
      <thead>
        <tr className="text-base bg-gray-5 py-3 font-medium">
          <th className="border-b-2 text-left border-blue-500">Party</th>
          <th className="border-b-2 text-center border-blue-500">Votes</th>
          <th className="border-b-2 text-center border-blue-500">%</th>
        </tr>
      </thead>
      <tbody className="text-sm text-left font-light text-gray-700">
        {votes
          .sort((a, b) => b.totalVotes - a.totalVotes)
          .slice(0, 5)
          .map((v) => {
            const party = findParty(v.key);
            return (
              <tr
                className="border-b border-gray-200 hover:bg-gray-100 font-medium"
                key={v.key}
              >
                <td className="px-2 py-1  text-white">
                  <div
                    className={`px-2 `}
                    style={{ backgroundColor: party?.color }}
                  >
                    {party?.nickName || "unknown party"}
                  </div>
                </td>
                <td className="px-2 text-right">{v.totalVotes}</td>
                <td className="px-2 text-right">
                  {formatPct(100 * (v.totalVotes / totalVotes))}
                </td>
              </tr>
            );
          })}
      </tbody>
    </table>
  );
};
