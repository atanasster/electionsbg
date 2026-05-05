import { FC, useMemo } from "react";
import { Votes } from "@/data/dataTypes";
import { usePartyInfo } from "@/data/parties/usePartyInfo";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { useTranslation } from "react-i18next";
import { formatPct, formatThousands } from "@/data/utils";
import { useTopParties } from "@/data/parties/useTopParties";

export const PartyVotesXS: FC<{
  votes?: Votes[];
  className?: string;
}> = ({ votes, className }) => {
  const { findParty } = usePartyInfo();
  const { displayNameFor } = useCanonicalParties();
  const { t } = useTranslation();
  const total = useMemo(() => {
    return votes?.reduce((acc, curr) => acc + curr.totalVotes, 0);
  }, [votes]);

  const parties = useTopParties(votes, 4);
  if (!parties?.length) return null;

  return (
    <div className={className}>
      <div className="text-[10px] uppercase tracking-wide opacity-70 text-center mb-1">
        {`${formatThousands(total)} ${t("votes")}`}
      </div>
      <table className="w-full border-collapse text-[11px] leading-tight">
        <tbody>
          {parties.map((v) => {
            const party = findParty(v.partyNum);
            const pct = total ? (100 * v.totalVotes) / total : 0;
            return (
              <tr key={v.partyNum} className="font-medium">
                <td className="py-0.5 pr-2">
                  <div className="flex items-center gap-1.5 max-w-[140px]">
                    <span
                      aria-hidden
                      className="inline-block h-2 w-2 rounded-sm shrink-0"
                      style={{ backgroundColor: party?.color }}
                    />
                    <span className="truncate">
                      {party?.nickName
                        ? (displayNameFor(party.nickName) ?? party.nickName)
                        : t("unknown_party")}
                    </span>
                  </div>
                </td>
                <td className="py-0.5 pr-2 text-right tabular-nums opacity-90">
                  {formatThousands(v.totalVotes)}
                </td>
                <td className="py-0.5 text-right tabular-nums font-semibold">
                  {total ? formatPct(pct) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
