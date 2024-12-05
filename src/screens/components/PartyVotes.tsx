import { SectionProtocol, Votes } from "@/data/dataTypes";
import { usePartyInfo } from "@/data/usePartyInfo";
import { formatPct, formatThousands } from "@/data/utils";
import { DataTable } from "@/ux/DataTable";
import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";

export const PartyVotes: FC<{ protocol: SectionProtocol; votes: Votes[] }> = ({
  protocol,
  votes,
}) => {
  const { parties } = usePartyInfo();
  const { t } = useTranslation();
  const data = useMemo(() => {
    return parties
      ?.sort((a, b) => a.number - b.number)
      .map((party) => {
        const vote = votes.find((v) => v.partyNum === party.number);
        return {
          ...vote,
          key: party?.number,
          party: party?.name,
          color: party?.color,
          pct_votes:
            vote?.totalVotes &&
            (protocol.numValidVotes || protocol.numValidMachineVotes)
              ? (100 * vote?.totalVotes) /
                ((protocol.numValidVotes || 0) +
                  (protocol.numValidMachineVotes || 0))
              : 0,
        };
      });
  }, [parties, protocol.numValidMachineVotes, protocol.numValidVotes, votes]);
  return (
    data && (
      <DataTable
        pageSize={data.length}
        columns={[
          {
            accessorKey: "key",
            header: "#",
            size: 70,
            cell: ({ row }) => {
              return (
                <div
                  className="text-white text-right px-2 my-2 font-bold w-14"
                  style={{ backgroundColor: row.original["color"] }}
                >
                  {row.getValue("key")}
                </div>
              );
            },
          },
          { accessorKey: "party", header: t("party") },
          {
            accessorKey: "paperVotes",
            header: t("paper_votes"),
            hidden: !protocol.numValidMachineVotes,
            cell: ({ row }) => (
              <div className="px-4 py-2 text-right">
                {formatThousands(row.getValue("paperVotes"))}
              </div>
            ),
          },
          {
            accessorKey: "numValidMachineVotes",
            header: t("machine_votes"),
            hidden: !protocol.numValidMachineVotes,
            cell: ({ row }) => (
              <div className="px-4 text-right">
                {formatThousands(row.getValue("numValidMachineVotes"))}
              </div>
            ),
          },
          {
            accessorKey: "totalVotes",
            header: t("total_votes"),
            cell: ({ row }) => (
              <div className="px-4 text-right">
                {formatThousands(row.getValue("totalVotes"))}
              </div>
            ),
          },
          {
            accessorKey: "pct_votes",
            header: "%",
            cell: ({ row }) => {
              return (
                <div className="px-4 text-right">
                  {!!row.getValue("pct_votes") &&
                    formatPct(row.getValue("pct_votes"), 2)}
                </div>
              );
            },
          },
        ]}
        data={data}
      />
    )
  );
};
