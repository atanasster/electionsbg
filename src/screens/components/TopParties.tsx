import { PartyInfo, Votes } from "@/data/dataTypes";
import { useTopParties } from "@/data/useTopParties";
import { formatPct, formatThousands } from "@/data/utils";
import { DataTable } from "@/ux/DataTable";
import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { PartyLabel } from "./PartyLabel";

export const TopParties: FC<{
  votes?: Votes[];
  prevElectionVotes?: (Votes & { nickName?: string })[] | null;
}> = ({ votes, prevElectionVotes }) => {
  const { t } = useTranslation();
  const parties = useTopParties(votes, 1);
  const data = useMemo(() => {
    return prevElectionVotes
      ? parties?.map((p) => {
          const d = prevElectionVotes.find((pr) => pr.nickName === p.nickName);
          return {
            ...p,
            prevTotalVotes: d?.totalVotes,
            pctPrevChange:
              d && d.totalVotes
                ? (100 * (p.totalVotes - d.totalVotes)) / d.totalVotes
                : undefined,
          };
        })
      : parties;
  }, [parties, prevElectionVotes]);
  return data?.length ? (
    <div className="w-full md:w-auto">
      <DataTable
        pageSize={data.length}
        columns={[
          {
            accessorKey: "partyNum",
            header: "#",
            size: 70,
          },

          {
            accessorKey: "nickName",
            header: t("party"),
            cell: ({ row }) => {
              return <PartyLabel party={row.original as PartyInfo} />;
            },
          },
          {
            accessorKey: "totalVotes",
            header: t("total_votes"),
            cell: ({ row }) => (
              <div className="px-4 py-2 text-right">
                {formatThousands(row.getValue("totalVotes"))}
              </div>
            ),
          },
          {
            accessorKey: "pctVotes",
            header: "%",
            cell: ({ row }) => {
              return (
                <div className="px-4 py-2 text-right">
                  {formatPct(row.getValue("pctVotes"), 2)}
                </div>
              );
            },
          },
          {
            accessorKey: "prevTotalVotes",
            hidden: !prevElectionVotes,
            header: t("prior_elections"),
            cell: ({ row }) => (
              <div className="px-4 py-2 text-right">
                {formatThousands(row.getValue("prevTotalVotes"))}
              </div>
            ),
          },
          {
            accessorKey: "pctPrevChange",
            hidden: !prevElectionVotes,
            header: `% ${t("change")}`,
            cell: ({ row }) => {
              const pctChange: number = row.getValue("pctPrevChange");
              return (
                <div
                  className={`px-4 py-2 font-bold text-right ${pctChange && pctChange < 0 ? "text-destructive" : "text-secondary-foreground"}`}
                >
                  {formatPct(row.getValue("pctPrevChange"), 2)}
                </div>
              );
            },
          },
        ]}
        data={data}
      />
    </div>
  ) : null;
};
