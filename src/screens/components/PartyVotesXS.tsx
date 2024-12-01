import { FC, useMemo } from "react";
import { Votes } from "@/data/dataTypes";
import { usePartyInfo } from "@/data/usePartyInfo";
import { useTranslation } from "react-i18next";
import { formatPct, formatThousands } from "@/data/utils";
import { useTopParties } from "@/data/useTopParties";

export const PartyVotesXS: FC<{
  votes: Votes[];
}> = ({ votes }) => {
  const { findParty } = usePartyInfo();
  const { t } = useTranslation();
  const total = useMemo(() => {
    return votes.reduce((acc, curr) => acc + curr.totalVotes, 0);
  }, [votes]);

  const parties = useTopParties(votes);
  return (
    <div>
      <table className="w-full border border-collapse table-auto">
        <thead>
          <tr className="text-base bg-gray-5 py-3 font-medium">
            <th className="border-b-2 text-left px-2">{t("party")}</th>
            <th className="border-b-2 text-center ">{t("votes")}</th>
            <th className="border-b-2 text-center ">%</th>
          </tr>
        </thead>
        <tbody className="text-sm text-left font-light text-primary-foreground">
          {parties?.map((v) => {
            const party = findParty(v.partyNum);
            return (
              <tr
                className="border-b border-muted font-medium"
                key={v.partyNum}
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
                  {total ? formatPct(100 * (v.totalVotes / total)) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
