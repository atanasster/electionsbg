import {
  PartyInfo,
  PartyVotes,
  RecountOriginal,
  VoteResults,
} from "@/data/dataTypes";
import { useTopParties } from "@/data/parties/useTopParties";
import { DataTable, DataTableColumns } from "@/ux/data_table/DataTable";
import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useMediaQueryMatch } from "@/ux/useMediaQueryMatch";
import { Caption } from "@/ux/Caption";
import { PartyLink } from "./party/PartyLink";
import { pctChange } from "@/data/utils";

export const PartyRecountTable: FC<{
  votes?: { results?: VoteResults; original?: RecountOriginal };
  title: string;
}> = ({ votes, title }) => {
  const { results, original } = votes || {};
  const { t } = useTranslation();
  const isXSmall = useMediaQueryMatch("xs");
  const isSmall = useMediaQueryMatch("sm");
  const hasPaperVotes =
    results?.votes.find((v) => v.paperVotes) ||
    original?.addedPaperVotes ||
    original?.removedPaperVotes;
  const hasMachineVotes =
    results?.votes.find((v) => v.machineVotes) ||
    original?.addedMachineVotes ||
    original?.removedMachineVotes;
  const parties = useTopParties(results?.votes, 0);
  const data = useMemo(() => {
    return parties
      ?.map((p) => {
        const o = original?.votes.find((o) => o.partyNum === p.partyNum);
        const totalVotesChange = o ? o.addedVotes + o.removedVotes : 0;

        const pctTotalVotesChange = pctChange(
          p.totalVotes,
          p.totalVotes - totalVotesChange,
        );
        return {
          ...p,
          paperVotesChange: o ? o.addedPaperVotes + o.removedPaperVotes : 0,
          machineVotesChange: o
            ? o.addedMachineVotes + o.removedMachineVotes
            : 0,
          totalVotesChange,
          pctTotalVotesChange,
        };
      })
      .filter(
        (p) =>
          p.paperVotes ||
          p.machineVotes ||
          p.paperVotesChange ||
          p.machineVotesChange,
      );
  }, [original?.votes, parties]);
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
        header: t("paper_votes"),
        hidden: isSmall || !hasPaperVotes,
        colSpan: 2,
        columns: [
          {
            accessorKey: "paperVotes",
            header: t("recounted_votes"),
            hidden: isSmall || !hasPaperVotes,
            dataType: "thousands",
          },
          {
            accessorKey: "paperVotesChange",
            header: t("change"),
            hidden: isSmall || !hasPaperVotes,
            dataType: "thousandsChange",
          },
        ],
      },
      {
        header: t("machine_votes"),
        hidden: isSmall || !hasMachineVotes,
        colSpan: 2,
        columns: [
          {
            accessorKey: "machineVotes",
            header: t("recounted_votes"),
            hidden: isSmall || !hasPaperVotes,
            dataType: "thousands",
          },
          {
            accessorKey: "machineVotesChange",
            header: t("change"),
            hidden: isSmall || !hasPaperVotes,
            dataType: "thousandsChange",
          },
        ],
      },
      {
        header: isXSmall ? t("votes") : t("total_votes"),
        colSpan: 2,
        columns: [
          {
            accessorKey: "totalVotes",
            header: t("recounted_votes"),
            dataType: "thousands",
          },
          {
            accessorKey: "totalVotesChange",
            header: t("change"),
            dataType: "thousandsChange",
          },
        ],
      },
      {
        accessorKey: "pctTotalVotesChange",
        headerHint: t("pct_recount_changes_explainer"),
        header: "%",
        dataType: "pctChange",
      },
    ],
    [isXSmall, t, isSmall, hasPaperVotes, hasMachineVotes],
  );
  return data?.length ? (
    <div className="w-full">
      <Caption className="py-8">{t("voting_recount")}</Caption>
      <DataTable
        title={title}
        pageSize={data.length}
        columns={columns}
        stickyColumn={true}
        data={data}
      />
    </div>
  ) : null;
};
