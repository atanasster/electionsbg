import { PartyFiling, PartyInfo } from "@/data/dataTypes";
import { useElectionContext } from "@/data/ElectionContext";
import { DataTable, DataTableColumns } from "@/ux/data_table/DataTable";
import { useQuery } from "@tanstack/react-query";
import { financingRecordsQueryFn } from "@/data/financing/usePartiesFinancing";
import { useMemo } from "react";
import {
  findPrevVotes,
  formatThousands,
  localDate,
  totalActualVoters,
  totalIncomeFiling,
} from "@/data/utils";
import { useTranslation } from "react-i18next";
import { usePartyInfo } from "@/data/parties/usePartyInfo";
import { useRegionVotes } from "@/data/regions/useRegionVotes";
import { Title } from "@/ux/Title";
import { useMediaQueryMatch } from "@/ux/useMediaQueryMatch";
import { useLastYearParties } from "@/data/parties/useLastYearParties";
import { PartyLink } from "../party/PartyLink";
import { SOURCE_COLOR } from "./financingConstants";
import { SourceLegend } from "./financingShared";
import { Hint } from "@/ux/Hint";

export const FinancingTable = ({ hideTitle }: { hideTitle?: boolean } = {}) => {
  const { selected, priorElections } = useElectionContext();
  // Use the shared, guarded fetcher (same one usePartiesFinancing registers on
  // this key) so behaviour doesn't depend on which observer mounts first.
  const { data: raw } = useQuery({
    queryKey: ["parties_financing", selected],
    queryFn: financingRecordsQueryFn,
  });
  const { data: raw_last_year } = useQuery({
    queryKey: ["parties_prev_year_financing", priorElections?.name],
    queryFn: financingRecordsQueryFn,
    enabled: !!priorElections,
  });
  const { partyByNickName } = useLastYearParties();
  const { countryVotes } = useRegionVotes();
  const { results } = countryVotes();
  const { t } = useTranslation();
  const { findParty } = usePartyInfo();
  const isMedium = useMediaQueryMatch("md");
  const data = useMemo(() => {
    if (results?.votes) {
      const totalVotes = totalActualVoters(results?.votes);
      return raw
        ?.map((r) => {
          const party = findParty(r.party);
          const vote = results.votes.find((v) => v.partyNum === r.party);
          let lyIncome: number | undefined = undefined;
          if (party && raw_last_year) {
            const lyParty = partyByNickName(party.nickName);
            const ly = lyParty
              ? raw_last_year.find((l) => l.party === lyParty.number)
              : undefined;
            if (ly) {
              lyIncome = totalIncomeFiling(ly.filing.income);
            }
          }
          const { prevTotalVotes } = findPrevVotes(
            party,
            priorElections?.results?.votes,
            true,
          );
          const totalIncome = totalIncomeFiling(r.filing.income);

          const pctPrevChange =
            vote && prevTotalVotes
              ? (100 * (vote.totalVotes - prevTotalVotes)) / prevTotalVotes
              : undefined;
          const pctIncomeChange = lyIncome
            ? (100 * (totalIncome - lyIncome)) / lyIncome
            : undefined;
          return {
            prevTotalVotes,
            pctPrevChange,
            ...r.filing,
            ...party,
            pctVotes: totalVotes
              ? (100 * (vote?.totalVotes || 0)) / totalVotes
              : undefined,
            totalVotes: vote?.totalVotes,
            totalFromParties:
              r.filing.income.party.monetary +
              r.filing.income.party.nonMonetary,
            totalFromDonors:
              r.filing.income.donors.monetary +
              r.filing.income.donors.nonMonetary,
            totalFromCandidates:
              r.filing.income.candidates.monetary +
              r.filing.income.candidates.nonMonetary,
            totalMediaPackage: r.filing.income.mediaPackage,
            totalIncome,
            lyIncome,
            pctIncomeChange,
          };
        })
        .sort((a, b) => b.totalIncome - a.totalIncome);
    }
    return undefined;
  }, [
    findParty,
    partyByNickName,
    priorElections?.results?.votes,
    raw,
    raw_last_year,
    results.votes,
  ]);
  const columns: DataTableColumns<
    PartyFiling &
      PartyInfo & {
        totalFromParties: number;
        totalFromDonors: number;
        totalFromCandidates: number;
        totalMediaPackage: number;
        totalIncome: number;
      },
    unknown
  > = useMemo(
    () => [
      {
        accessorKey: "party",
        header: t("party"),
        accessorFn: (row) => `${row.number},${row.nickName}`,
        cell: ({ row }) => <PartyLink party={row.original} />,
      },
      {
        accessorKey: "totalVotes",
        hidden: true,
        headerHint: t("total_party_votes_explainer"),
        header: t("total_votes"),
        dataType: "thousands",
      },
      {
        accessorKey: "pctVotes",
        headerHint: t("pct_party_votes_explainer"),
        header: "%",
        dataType: "percent",
      },
      {
        accessorKey: "pctPrevChange",
        hidden: !priorElections,
        headerHint: t("pct_prev_election_votes_explainer"),
        header: `+/-`,
        className: "font-bold",
        dataType: "pctChange",
      },
      {
        headerHint: t("source_of_income_explainer"),
        header: t("source"),
        colSpan: 4,
        hidden: !isMedium,
        id: "source",
        columns: [
          {
            header: t("parties"),
            accessorKey: "totalFromParties",
            dataType: "money",
          },
          {
            header: t("donors"),
            accessorKey: "totalFromDonors",
            dataType: "money",
          },
          {
            header: t("candidates"),
            accessorKey: "totalFromCandidates",
            dataType: "money",
          },
          {
            header: t("media"),
            accessorKey: "totalMediaPackage",
            dataType: "money",
          },
        ],
      },
      {
        // The income figure with a folded-in mini funding-mix bar (the four
        // sources), so the composition reads inline without a separate chart —
        // and stays visible on small screens where the source columns hide.
        accessorKey: "totalIncome",
        headerHint: t("total_financing_explainer"),
        header: t("income"),
        sortingFn: "basic",
        cell: ({ row }) => {
          const r = row.original;
          const total = r.totalIncome || 0;
          const segs: { v: number; c: string; label: string }[] = [
            {
              v: r.totalFromParties,
              c: SOURCE_COLOR.parties,
              label: t("parties"),
            },
            {
              v: r.totalFromDonors,
              c: SOURCE_COLOR.donors,
              label: t("donors"),
            },
            {
              v: r.totalFromCandidates,
              c: SOURCE_COLOR.candidates,
              label: t("candidates"),
            },
            {
              v: r.totalMediaPackage,
              c: SOURCE_COLOR.media,
              label: t("media"),
            },
          ];
          const breakdown = (
            <div className="flex min-w-[13rem] flex-col gap-1">
              {segs.map((s) => (
                <div
                  key={s.label}
                  className="flex items-center justify-between gap-4"
                >
                  <span className="flex items-center gap-1.5">
                    <span
                      className="h-2.5 w-2.5 rounded-sm"
                      style={{ backgroundColor: s.c }}
                    />
                    {s.label}
                  </span>
                  <span className="tabular-nums">
                    {formatThousands(s.v, 2)}
                    <span className="ml-2 text-muted-foreground">
                      {total > 0 ? `${Math.round((100 * s.v) / total)}%` : ""}
                    </span>
                  </span>
                </div>
              ))}
              <div className="mt-1 flex items-center justify-between gap-4 border-t border-border/40 pt-1 font-semibold">
                <span>{t("income")}</span>
                <span className="tabular-nums">
                  {formatThousands(total, 2)}
                </span>
              </div>
            </div>
          );
          return (
            <div className="flex justify-end">
              <Hint text={breakdown} underline={false}>
                <div className="flex min-w-[92px] flex-col items-end gap-1">
                  <span className="font-bold tabular-nums">
                    {formatThousands(total, 2)}
                  </span>
                  <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    {segs.map((s, i) =>
                      s.v > 0 && total > 0 ? (
                        <div
                          key={i}
                          className="h-full"
                          style={{
                            width: `${(100 * s.v) / total}%`,
                            backgroundColor: s.c,
                          }}
                        />
                      ) : null,
                    )}
                  </div>
                </div>
              </Hint>
            </div>
          );
        },
      },
      {
        id: "last_year",
        hidden: !raw_last_year,
        headerHint: t("prior_campaign_financing_explainer"),
        header: priorElections
          ? localDate(priorElections.name)
          : t("prior_campaign"),
        colSpan: 2,
        columns: [
          {
            accessorKey: "lyIncome",
            hidden: !priorElections,
            headerHint: t("total_financing_prev_campaign_explainer"),
            header: priorElections
              ? localDate(priorElections.name)
              : t("income"),
            dataType: "money",
          },
          {
            accessorKey: "pctIncomeChange",
            hidden: !priorElections,
            headerHint: t("total_financing_ptc_change_explainer"),
            header: "+/-",
            className: "font-bold text-right",
            dataType: "pctChange",
          },
        ],
      },
    ],
    [isMedium, priorElections, raw_last_year, t],
  );
  return (
    <div className="w-full">
      {!hideTitle && <Title className="py-8">{t("campaign_financing")}</Title>}
      <div className="mb-2 flex justify-end px-1">
        <SourceLegend
          labels={{
            parties: t("parties"),
            donors: t("donors"),
            candidates: t("candidates"),
            media: t("media"),
          }}
        />
      </div>
      <DataTable
        title={t("campaign_financing")}
        pageSize={50}
        columns={columns}
        stickyColumn={true}
        data={data || []}
      />
    </div>
  );
};
