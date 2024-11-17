import { SectionProtocol, Votes } from "@/data/dataTypes";
import { useElectionInfo } from "@/data/ElectionsContext";
import { formatPct, formatThousands } from "@/data/utils";
import { DataTable } from "@/ux/DataTable";
import { FC } from "react";
import { useTranslation } from "react-i18next";

export const PartyVotes: FC<{ protocol: SectionProtocol; votes: Votes[] }> = ({
  protocol,
  votes,
}) => {
  const { findParty } = useElectionInfo();
  const { t } = useTranslation();
  return (
    <>
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

      <table className="w-full border border-collapse table-auto text-muted-foreground">
        <thead>
          <tr className="font-bold text-left bg-gray-5">
            <th className="px-4 py-2 border-b-2">#</th>
            <th className="px-4 py-2 border-b-2">{t("party")}</th>
            {!!protocol.numValidMachineVotes && (
              <>
                <th className="px-4 py-2 border-b-2 text-center">
                  {t("machine_votes")}
                </th>
                <th className="px-4 py-2 border-b-2 text-center">
                  {t("paper_votes")}
                </th>
              </>
            )}
            <th className="px-4 py-2 border-b-2 text-center">
              {t("total_votes")}
            </th>
            <th className="px-4 py-2 border-b-2 text-right">%</th>
          </tr>
        </thead>
        <tbody className="text-sm text-left font-normal">
          {votes
            .sort((a, b) => a.key - b.key)
            .map((vote) => {
              const party = findParty(vote.key);
              return (
                <tr
                  className="py-10 border-b border-gray-200 hover:bg-secondary"
                  key={vote.key}
                >
                  <td className="px-4 ">
                    <div
                      className="text-white text-right px-2 font-bold"
                      style={{ backgroundColor: party?.color }}
                    >
                      {vote.key}
                    </div>
                  </td>
                  <td className="px-4 py-2">
                    {party?.name || "unknown party"}
                  </td>
                  {!!protocol.numValidMachineVotes && (
                    <>
                      <td className="px-4 py-2 text-right">
                        {vote.machineVotes
                          ? formatThousands(vote.machineVotes)
                          : "-"}
                      </td>
                      <td className="px-4 py-2 text-right">
                        {vote.paperVotes
                          ? formatThousands(vote.paperVotes)
                          : "-"}
                      </td>
                    </>
                  )}
                  <td className="px-4 py-2 text-right">
                    {vote.totalVotes ? formatThousands(vote.totalVotes) : "-"}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {vote.totalVotes
                      ? formatPct(
                          100 *
                            (vote.totalVotes /
                              (protocol.numValidVotes +
                                (protocol.numValidMachineVotes || 0))),
                          2,
                        )
                      : "-"}
                  </td>
                </tr>
              );
            })}
        </tbody>
      </table>
    </>
  );
};
