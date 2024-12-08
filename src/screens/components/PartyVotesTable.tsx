import { ElectionInfo, PartyInfo, PartyVotes, Votes } from "@/data/dataTypes";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useTopParties } from "@/data/useTopParties";
import { formatPct, formatThousands } from "@/data/utils";
import { DataTable, DataTableColumns } from "@/ux/DataTable";
import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { PartyLabel } from "./PartyLabel";
import { useMediaQueryMatch } from "@/ux/useMediaQueryMatch";
import { Hint } from "@/ux/Hint";
import { HistoryChart } from "./HistoryChart";
import { DialogClose } from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { ChartArea } from "lucide-react";

export const PartyVotesTable: FC<{
  votes?: Votes[];
  stats?: ElectionInfo[];
  prevElectionVotes?: (Votes & { nickName?: string })[] | null;
}> = ({ votes, prevElectionVotes, stats }) => {
  const { t } = useTranslation();
  const isXSmall = useMediaQueryMatch("xs");
  const isSmall = useMediaQueryMatch("sm");
  const isLarge = useMediaQueryMatch("lg");
  const hasPaperVotes = votes?.find((v) => v.paperVotes);
  const hasMachineVotes = votes?.find((v) => v.machineVotes);
  const parties = useTopParties(votes, 0);
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
        hidden: isXSmall && !!stats,
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
        accessorKey: "paperVotes",
        header: t("paper_votes"),
        hidden: isSmall || !hasPaperVotes,
        cell: ({ row }) => (
          <div className="px-4 py-2 text-right">
            {formatThousands(row.getValue("paperVotes"))}
          </div>
        ),
      },
      {
        accessorKey: "machineVotes",
        header: t("machine_votes"),
        hidden: isSmall || !hasMachineVotes,
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
      {
        accessorKey: "chart",
        hidden: !prevElectionVotes,
        header: (
          <Hint text={t("all_elections_explainer")}>
            <div>{isLarge ? t("all_elections") : t("chart")}</div>
          </Hint>
        ) as never,
        cell: ({ row }) =>
          stats && (
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="ghost" className="my-2">
                  {isLarge ? (
                    <HistoryChart
                      className="min-w-60 h-12"
                      party={row.original as PartyInfo}
                      stats={stats}
                      cursorPointer={true}
                      animationDuration={0}
                    />
                  ) : (
                    <ChartArea />
                  )}
                </Button>
              </DialogTrigger>
              <DialogContent className="md:max-w-lg text-primary">
                <DialogHeader>
                  <DialogTitle>
                    {(row.original as PartyInfo).nickName}
                  </DialogTitle>
                  <DialogDescription>
                    {t("all_elections_explainer")}
                  </DialogDescription>
                </DialogHeader>
                <div className="flex items-center space-x-2">
                  <div className="grid flex-1 gap-2">
                    <HistoryChart
                      party={row.original as PartyInfo}
                      xAxis={true}
                      stats={stats}
                    />
                  </div>
                </div>
                <DialogFooter className="sm:justify-start">
                  <DialogClose asChild>
                    <Button type="button" variant="secondary">
                      {t("close")}
                    </Button>
                  </DialogClose>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          ),
      },
    ],
    [
      hasMachineVotes,
      hasPaperVotes,
      isSmall,
      isXSmall,
      isLarge,
      prevElectionVotes,
      stats,
      t,
    ],
  );
  return data?.length ? (
    <div className="w-full">
      <DataTable pageSize={data.length} columns={columns} data={data} />
    </div>
  ) : null;
};
