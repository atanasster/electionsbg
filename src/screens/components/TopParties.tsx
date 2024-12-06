import { PartyInfo, PartyVotes, Votes } from "@/data/dataTypes";
import { useTopParties } from "@/data/useTopParties";
import { formatPct, formatThousands } from "@/data/utils";
import { DataTable, DataTableColumns } from "@/ux/DataTable";
import { FC, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { PartyLabel } from "./PartyLabel";
import { useMediaQueryMatch } from "@/ux/useMediaQueryMatch";
import { Hint } from "@/ux/Hint";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const TopParties: FC<{
  votes?: Votes[];
  prevElectionVotes?: (Votes & { nickName?: string })[] | null;
}> = ({ votes, prevElectionVotes }) => {
  const { t } = useTranslation();
  const [tab, tabChange] = useState(
    localStorage.getItem("top_parties_view") || "tab1pct",
  );
  const onTabChange = (value: string) => {
    localStorage.setItem("top_parties_view", value);
    tabChange(value);
  };
  const isXSmall = useMediaQueryMatch("xs");
  const parties = useTopParties(votes, tab === "tab1pct" ? 1 : 0);
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
  const columns: DataTableColumns<PartyVotes, unknown> = useMemo(
    () => [
      {
        accessorKey: "partyNum",
        hidden: isXSmall,
        header: (
          <Hint text={t("party_num_explainer")}>
            <div>#</div>
          </Hint>
        ) as never,
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
        header: (
          <Hint text={t("total_party_votes_explainer")}>
            <div>{isXSmall ? t("votes") : t("total_votes")}</div>
          </Hint>
        ) as never,
        cell: ({ row }) => (
          <div className="px-4 py-2 text-right">
            {formatThousands(row.getValue("totalVotes"))}
          </div>
        ),
      },
      {
        accessorKey: "pctVotes",
        header: (
          <Hint text={t("pct_party_votes_explainer")}>
            <div>%</div>
          </Hint>
        ) as never,
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
        header: (
          <Hint text={t("prev_election_votes_explainer")}>
            <div>{isXSmall ? t("prior") : t("prior_elections")}</div>
          </Hint>
        ) as never,
        cell: ({ row }) => (
          <div className="px-4 py-2 text-right">
            {formatThousands(row.getValue("prevTotalVotes"))}
          </div>
        ),
      },
      {
        accessorKey: "pctPrevChange",

        hidden: !prevElectionVotes,
        header: (
          <Hint text={t("pct_prev_election_votes_explainer")}>
            <div>{isXSmall ? `+/-` : `% ${t("change")}`}</div>
          </Hint>
        ) as never,
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
    ],
    [isXSmall, prevElectionVotes, t],
  );
  return data?.length ? (
    <div className="w-full md:w-auto">
      <Tabs value={tab} onValueChange={onTabChange} className="w-[400px]">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="tab1pct">{t("top_1pct_parties")}</TabsTrigger>
          <TabsTrigger value="tabAll">{t("all_parties")}</TabsTrigger>
        </TabsList>
      </Tabs>
      <DataTable pageSize={data.length} columns={columns} data={data} />
    </div>
  ) : null;
};
