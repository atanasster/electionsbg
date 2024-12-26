import { FC, useMemo } from "react";
import { Votes } from "@/data/dataTypes";
import { usePartyInfo } from "@/data/parties/usePartyInfo";
import { useTranslation } from "react-i18next";
import { formatPct, formatThousands } from "@/data/utils";
import { useTopParties } from "@/data/parties/useTopParties";
import { PartyLabel } from "./party/PartyLabel";

export const PartyVotesXS: FC<{
  votes?: Votes[];
  className?: string;
}> = ({ votes, className }) => {
  const { findParty } = usePartyInfo();
  const { t } = useTranslation();
  const total = useMemo(() => {
    return votes?.reduce((acc, curr) => acc + curr.totalVotes, 0);
  }, [votes]);

  const parties = useTopParties(votes, 4);
  return (
    <div className={className}>
      {!!parties?.length && (
        <>
          <div className="text-center text-xs mb-1">
            {`${t("total")} ${formatThousands(total)} ${t("votes")}`}
          </div>
          <table className="w-full border rounded-md border-collapse table-auto">
            <thead>
              <tr className="border-b text-xs bg-gray-5 py-3">
                <th className="text-left p-2">{t("party")}</th>
                <th className="text-center ">{t("votes")}</th>
                <th className="text-center ">%</th>
              </tr>
            </thead>
            <tbody className="divide-y  text-xs text-right font-light">
              {parties.map((v) => {
                const party = findParty(v.partyNum);
                return (
                  <tr className="font-medium" key={v.partyNum}>
                    <td className="px-1 py-0.5 ">
                      <PartyLabel className="py-0.5" party={party} />
                    </td>
                    <td className="px-1">{formatThousands(v.totalVotes)}</td>
                    <td className="px-1">
                      {total ? formatPct(100 * (v.totalVotes / total)) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
};
