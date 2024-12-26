import {
  ElectionInfo,
  PartyInfo,
  PartyVotes,
  VoteResults,
} from "@/data/dataTypes";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useTopParties } from "@/data/parties/useTopParties";
import { findPrevVotes, formatPct, formatThousands } from "@/data/utils";
import { DataTable, DataTableColumns } from "@/ux/DataTable";
import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useMediaQueryMatch } from "@/ux/useMediaQueryMatch";
import { Hint } from "@/ux/Hint";
import { HistoryChart } from "./charts/HistoryChart";
import { DialogClose } from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { ChartArea } from "lucide-react";
import { Caption } from "@/ux/Caption";
import { useConsolidatedLabel } from "./useConsolidatedLabel";
import { PartyLink } from "./party/PartyLink";

export const PartyVotesTable: FC<{
  results?: VoteResults;
  stats?: ElectionInfo[];
  prevElection?: ElectionInfo;
}> = ({ results, prevElection, stats }) => {
  const { t } = useTranslation();
  const { isConsolidated, consolidated } = useConsolidatedLabel();
  const isXSmall = useMediaQueryMatch("xs");
  const isSmall = useMediaQueryMatch("sm");
  const isLarge = useMediaQueryMatch("lg");
  const hasPaperVotes = results?.votes.find((v) => v.paperVotes);
  const hasMachineVotes = results?.votes.find((v) => v.machineVotes);
  const parties = useTopParties(results?.votes, 0);
  const data = useMemo(() => {
    const prevElectionVotes = prevElection?.results?.votes;
    const currentActivity = results?.protocol?.numRegisteredVoters
      ? 100 *
        (results.protocol.totalActualVoters /
          results.protocol.numRegisteredVoters)
      : 0;
    const prevActivity = prevElection?.results?.protocol?.numRegisteredVoters
      ? 100 *
        (prevElection.results.protocol.totalActualVoters /
          prevElection.results.protocol.numRegisteredVoters)
      : currentActivity;
    const activityChange = prevActivity - currentActivity;
    return prevElectionVotes
      ? parties?.map((p) => {
          const { prevTotalVotes } = findPrevVotes(
            p,
            prevElectionVotes,
            isConsolidated,
          );
          const pctPrevChange = prevTotalVotes
            ? (100 * (p.totalVotes - prevTotalVotes)) / prevTotalVotes
            : undefined;
          return {
            ...p,
            prevTotalVotes,
            pctPrevChange,
            adjustedPctPrevChange: pctPrevChange
              ? pctPrevChange + activityChange
              : undefined,
          };
        })
      : parties;
  }, [isConsolidated, parties, prevElection, results]);
  const columns: DataTableColumns<PartyVotes, unknown> = useMemo(
    () => [
      {
        accessorKey: "partyNum",
        header: t("party"),
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
        accessorKey: "paperVotes",
        header: t("paper_votes"),
        hidden: isSmall || !hasPaperVotes,
        className: "text-right",
        cell: ({ row }) => formatThousands(row.getValue("paperVotes")),
      },
      {
        accessorKey: "machineVotes",
        header: t("machine_votes"),
        hidden: isSmall || !hasMachineVotes,
        className: "text-right",
        cell: ({ row }) => formatThousands(row.getValue("machineVotes")),
      },
      {
        accessorKey: "totalVotes",
        header: (
          <Hint text={t("total_party_votes_explainer")}>
            <div>{isXSmall ? t("votes") : t("total_votes")}</div>
          </Hint>
        ) as never,
        className: "text-right",
        cell: ({ row }) => formatThousands(row.getValue("totalVotes")),
      },
      {
        accessorKey: "pctVotes",
        header: (
          <Hint text={t("pct_party_votes_explainer")}>
            <div>%</div>
          </Hint>
        ) as never,
        className: "text-right",
        cell: ({ row }) => formatPct(row.getValue("pctVotes"), 2),
      },
      {
        accessorKey: "prevTotalVotes",
        hidden: !prevElection,
        className: "text-right",
        header: (
          <Hint text={t("prev_election_votes_explainer")}>
            <div>{isXSmall ? t("prior") : t("prior_elections")}</div>
          </Hint>
        ) as never,
        cell: ({ row }) => formatThousands(row.getValue("prevTotalVotes")),
      },
      {
        accessorKey: "pctPrevChange",
        hidden: !prevElection,
        className: "font-bold text-right",
        header: (
          <Hint text={t("pct_prev_election_votes_explainer")}>
            <div>{isXSmall ? `+/-` : `% ${t("change")}`}</div>
          </Hint>
        ) as never,
        cell: ({ row }) => {
          const pctChange: number = row.getValue("pctPrevChange");
          return (
            <div
              className={`${pctChange && pctChange < 0 ? "text-destructive" : "text-secondary-foreground"}`}
            >
              {formatPct(row.getValue("pctPrevChange"), 2)}
            </div>
          );
        },
      },
      {
        accessorKey: "adjustedPctPrevChange",
        hidden: !prevElection || !isLarge,
        className: "font-bold text-right",
        header: (
          <Hint text={t("pct_adjusted_change_explainer")}>
            <div>{t("adjusted_change")}</div>
          </Hint>
        ) as never,
        cell: ({ row }) => {
          const pctChange: number = row.getValue("adjustedPctPrevChange");
          return (
            <div
              className={`${pctChange && pctChange < 0 ? "text-destructive" : "text-secondary-foreground"}`}
            >
              {formatPct(row.getValue("adjustedPctPrevChange"), 2)}
            </div>
          );
        },
      },

      {
        accessorKey: "chart",
        hidden: !prevElection,
        className: "py-0 md:py-0",
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
                      isConsolidated={isConsolidated}
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
                      isConsolidated={isConsolidated}
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
      isXSmall,
      stats,
      t,
      isSmall,
      hasPaperVotes,
      hasMachineVotes,
      prevElection,
      isLarge,
      isConsolidated,
    ],
  );
  return data?.length ? (
    <div className="w-full">
      <Caption className="py-8">{t("votes_by_party")}</Caption>
      {consolidated}
      <DataTable
        pageSize={data.length}
        columns={columns}
        stickyColumn={true}
        data={data}
      />
    </div>
  ) : null;
};
