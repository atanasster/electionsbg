import { PartyInfo, SectionProtocol, Votes } from "@/data/dataTypes";
import { usePartyInfo } from "@/data/usePartyInfo";
import { formatPct, formatThousands } from "@/data/utils";
import { DataTable, DataTableColumns } from "@/ux/DataTable";
import { useMediaQueryMatch } from "@/ux/useMediaQueryMatch";
import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { PartyLabel } from "./PartyLabel";
import { Hint } from "@/ux/Hint";

type DataType = Partial<Votes> & {
  key?: number;
  party?: string;
  color?: string;
  pct_votes?: number;
};
export const PartyVotes: FC<{ protocol: SectionProtocol; votes: Votes[] }> = ({
  protocol,
  votes,
}) => {
  const { parties } = usePartyInfo();
  const { t } = useTranslation();
  const isXSmall = useMediaQueryMatch("xs");
  const data: DataType[] | undefined = useMemo(() => {
    return parties
      ?.sort((a, b) => a.number - b.number)
      .map((party) => {
        const vote = votes.find((v) => v.partyNum === party.number);
        return {
          ...vote,
          number: party?.number,
          name: party?.name,
          nickName: party?.nickName,
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
  const columns: DataTableColumns<DataType, unknown> = useMemo(() => {
    return [
      {
        accessorKey: "number",
        header: (
          <Hint text={t("party_num_explainer")}>
            <div>#</div>
          </Hint>
        ) as never,
        size: 70,
        cell: ({ row }) => {
          return (
            <div className="text-secondary-foreground text-right px-2 my-2 font-bold w-14">
              {row.getValue("number")}
            </div>
          );
        },
      },
      {
        accessorKey: "nickName",
        header: t("party"),
        cell: ({ row }) => {
          return <PartyLabel party={row.original as PartyInfo} />;
        },
      },
      { accessorKey: "name", hidden: isXSmall, header: t("full_party_name") },
      {
        accessorKey: "paperVotes",
        header: t("paper_votes"),
        hidden: isXSmall || !protocol.numValidMachineVotes,
        cell: ({ row }) => (
          <div className="px-4 py-2 text-right">
            {formatThousands(row.getValue("paperVotes"))}
          </div>
        ),
      },
      {
        accessorKey: "machineVotes",
        header: t("machine_votes"),
        hidden: isXSmall || !protocol.numValidMachineVotes,
        cell: ({ row }) => (
          <div className="px-4 text-right">
            {formatThousands(row.getValue("machineVotes"))}
          </div>
        ),
      },
      {
        accessorKey: "totalVotes",
        header: (
          <Hint text={t("total_party_votes_explainer")}>
            <div>{isXSmall ? t("votes") : t("total_votes")}</div>
          </Hint>
        ) as never,
        cell: ({ row }) => (
          <div className="px-4 text-right">
            {formatThousands(row.getValue("totalVotes"))}
          </div>
        ),
      },
      {
        accessorKey: "pct_votes",
        header: (
          <Hint text={t("pct_party_votes_explainer")}>
            <div>%</div>
          </Hint>
        ) as never,
        cell: ({ row }) => {
          return (
            <div className="px-4 text-right">
              {!!row.getValue("pct_votes") &&
                formatPct(row.getValue("pct_votes"), 2)}
            </div>
          );
        },
      },
    ];
  }, [isXSmall, protocol.numValidMachineVotes, t]);
  return (
    data && <DataTable pageSize={data.length} columns={columns} data={data} />
  );
};
