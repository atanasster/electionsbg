import { FC } from "react";
import { VoteResults } from "@/data/dataTypes";
import { useElectionInfo } from "@/data/ElectionsContext";
import { useTranslation } from "react-i18next";
import { formatPct, formatThousands } from "@/data/utils";

export const PartyVotesXS: FC<{ results?: VoteResults }> = ({ results }) => {
  const { findParty } = useElectionInfo();
  const { t } = useTranslation();
  if (!results || results.votes.length === 0) {
    return null;
  }

  return (
    <div>
      <table className="w-full border border-collapse table-auto">
        <thead>
          <tr className="text-base bg-gray-5 py-3 font-medium">
            <th className="border-b-2 text-left border-blue-500">
              {t("party")}
            </th>
            <th className="border-b-2 text-center border-blue-500">
              {t("votes")}
            </th>
            <th className="border-b-2 text-center border-blue-500">%</th>
          </tr>
        </thead>
        <tbody className="text-sm text-left font-light text-gray-700">
          {results.votes
            .sort((a, b) => b.totalVotes - a.totalVotes)
            .slice(0, 5)
            .filter((v) => v.totalVotes > 0)
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
                      {party?.nickName || t("unknown_party")}
                    </div>
                  </td>
                  <td className="px-2 text-right">
                    {formatThousands(v.totalVotes)}
                  </td>
                  <td className="px-2 text-right">
                    {formatPct(100 * (v.totalVotes / results.actualTotal))}
                  </td>
                </tr>
              );
            })}
        </tbody>
      </table>
    </div>
  );
};
