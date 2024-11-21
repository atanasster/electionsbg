import { SectionProtocol, Votes } from "@/data/dataTypes";
import { usePartyInfo } from "@/data/ElectionsContext";
import { formatPct, formatThousands } from "@/data/utils";
import { DataTable } from "@/ux/DataTable";
import { FC } from "react";
import { useTranslation } from "react-i18next";

export const PartyVotes: FC<{ protocol: SectionProtocol; votes: Votes[] }> = ({
  protocol,
  votes,
}) => {
  const { findParty } = usePartyInfo();
  const { t } = useTranslation();
  return (
    <DataTable
      pageSize={votes.length}
      columns={[
        {
          accessorKey: "key",
          header: "#",
          size: 70,
          cell: ({ row }) => {
            return (
              <div
                className="text-white text-right px-2 font-bold w-14"
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
            <div className="px-4 py-2 text-right">
              {formatThousands(row.getValue("numValidMachineVotes"))}
            </div>
          ),
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
          accessorKey: "pct_votes",
          header: "%",
          cell: ({ row }) => {
            return (
              <div className="px-4 py-2 text-right">
                {formatPct(row.getValue("pct_votes"), 2)}
              </div>
            );
          },
        },
      ]}
      data={votes.map((v) => {
        const party = findParty(v.key);
        return {
          ...v,
          party: party?.name,
          color: party?.color,
          pct_votes:
            (100 * v.totalVotes) /
            (protocol.numValidVotes + (protocol.numValidMachineVotes || 0)),
        };
      })}
    />
  );
};
