import { PartyInfo, PartyVotes, VoteResults } from "@/data/dataTypes";
import { useTopParties } from "@/data/parties/useTopParties";
import { DataTable, DataTableColumns } from "@/ux/data_table/DataTable";
import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useMediaQueryMatch } from "@/ux/useMediaQueryMatch";
import { Caption } from "@/ux/Caption";
import { PartyLink } from "./party/PartyLink";
import { pctChange } from "@/data/utils";
import { ErrorSection } from "./ErrorSection";

export const PartySuemgTable: FC<{
  results?: VoteResults;
  title: string;
}> = ({ results, title }) => {
  const { t } = useTranslation();
  const isXSmall = useMediaQueryMatch("xs");
  const isSmall = useMediaQueryMatch("sm");
  const parties = useTopParties(results?.votes, 0);
  const hasPaperVotes = results?.votes.find((v) => v.paperVotes);
  const hasMachineVotes = results?.votes.find((v) => v.machineVotes);
  const data = useMemo(() => {
    return parties
      ?.filter((p) => p.suemgVotes !== undefined && p.machineVotes)
      .map((p) => {
        const machineVotesChange = (p.machineVotes || 0) - (p.suemgVotes || 0);
        const pctSuemg = pctChange(p.machineVotes, p.suemgVotes);
        const pctMachineVotesChange = pctChange(p.machineVotes, p.suemgVotes);
        const suemgTotal = (p.paperVotes || 0) + (p.suemgVotes || 0);
        const pctVotesChange = pctChange(p.totalVotes, suemgTotal);
        return {
          ...p,
          machineVotesChange,
          pctSuemg,
          pctMachineVotesChange,
          suemgTotal,
          pctVotesChange,
        };
      })

      .sort((a, b) => b.machineVotesChange - a.machineVotesChange);
  }, [parties]);
  const columns: DataTableColumns<PartyVotes, unknown> = useMemo(
    () => [
      {
        accessorKey: "partyNum",
        header: t("party"),
        accessorFn: (row) => `${row.partyNum},${row.nickName}`,
        cell: ({ row }) => (
          <PartyLink
            party={
              {
                number: row.original.partyNum,
                ...row.original,
              } as PartyInfo
            }
          />
        ),
      },
      {
        header: t("machine_votes"),
        colSpan: 2,
        columns: [
          {
            accessorKey: "machineVotes",
            header: t("recounted_votes"),
            dataType: "thousands",
          },
          {
            accessorKey: "suemgVotes",
            header: t("suemg"),
            dataType: "thousands",
          },
          {
            accessorKey: "machineVotesChange",
            header: t("change"),
            dataType: "thousandsChange",
          },
          {
            accessorKey: "pctSuemg",
            header: "%",
            hidden: isSmall,
            dataType: "pctChange",
          },
        ],
      },
      {
        header: isXSmall ? t("votes") : t("total_votes"),
        colSpan: 2,
        hidden: !hasPaperVotes,
        columns: [
          {
            accessorKey: "totalVotes",
            header: t("recounted_votes"),
            dataType: "thousands",
          },
          {
            accessorKey: "suemgTotal",
            header: t("suemg"),
            hidden: isSmall,
            dataType: "thousands",
          },
          {
            accessorKey: "pctVotesChange",
            header: "%",
            dataType: "pctChange",
          },
        ],
      },
    ],
    [t, isSmall, isXSmall, hasPaperVotes],
  );
  return data?.length && hasMachineVotes ? (
    <div className="w-full">
      <Caption className="py-8">{t("suemg_differences")}</Caption>
      <DataTable
        title={title}
        pageSize={data.length}
        columns={columns}
        stickyColumn={true}
        data={data}
      />
    </div>
  ) : (
    <ErrorSection title={t("no_machine_votes")} />
  );
};
