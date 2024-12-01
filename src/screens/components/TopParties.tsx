import { Votes } from "@/data/dataTypes";
import { useTopParties } from "@/data/useTopParties";
import { formatPct, formatThousands } from "@/data/utils";
import { DataTable } from "@/ux/DataTable";
import { FC } from "react";
import { useTranslation } from "react-i18next";

export const TopParties: FC<{ votes?: Votes[] }> = ({ votes }) => {
  const { t } = useTranslation();
  const parties = useTopParties(votes, 1);
  return parties?.length ? (
    <DataTable
      pageSize={parties.length}
      columns={[
        {
          accessorKey: "partyNum",
          header: "#",
          size: 70,
          cell: ({ row }) => {
            return (
              <div
                className="text-white text-right px-2 font-bold w-14"
                style={{ backgroundColor: row.original["color"] }}
              >
                {row.getValue("partyNum")}
              </div>
            );
          },
        },
        { accessorKey: "nickName", header: t("party") },
        { accessorKey: "partyName", header: t("party") },
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
      ]}
      data={parties}
    />
  ) : null;
};
