import { PartyIncomeRecord, PartyInfo } from "@/data/dataTypes";
import { useElectionContext } from "@/data/ElectionContext";
import { DataTable, DataTableColumns } from "@/ux/DataTable";
import { Hint } from "@/ux/Hint";
import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  findPrevVotes,
  formatPct,
  formatThousands,
  matchPartyNickName,
  localDate,
  totalActualVoters,
} from "@/data/utils";
import { useTranslation } from "react-i18next";
import { usePartyInfo } from "@/data/parties/usePartyInfo";
import { PartyLabel } from "../PartyLabel";
import { useRegionVotes } from "@/data/regions/useRegionVotes";
import { Title } from "@/ux/Title";
import { useMediaQueryMatch } from "@/ux/useMediaQueryMatch";
import { Link } from "@/ux/Link";

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<[string, string | null | undefined]>): Promise<
  PartyIncomeRecord[]
> => {
  if (!queryKey[1]) {
    return [];
  }
  const response = await fetch(`/${queryKey[1]}/parties/financing.json`);
  const data = await response.json();
  return data;
};

const lastYearPartiesQueryFn = async ({
  queryKey,
}: QueryFunctionContext<[string, string | null | undefined]>): Promise<
  PartyInfo[]
> => {
  if (!queryKey[1]) {
    return [];
  }
  const response = await fetch(`/${queryKey[1]}/cik_parties.json`);
  const data = await response.json();
  return data;
};

export const FinancingTable = () => {
  const { selected, priorElections } = useElectionContext();
  const { data: raw } = useQuery({
    queryKey: ["parties_financing", selected],
    queryFn,
  });
  const { data: raw_last_year } = useQuery({
    queryKey: ["parties_prev_year_financing", priorElections?.name],
    queryFn,
    enabled: !!priorElections,
  });
  const { data: parties_last_year } = useQuery({
    queryKey: ["parties_prev_year", priorElections?.name],
    queryFn: lastYearPartiesQueryFn,
    enabled: !!priorElections,
  });
  const { countryVotes } = useRegionVotes();
  const results = countryVotes();
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
          if (party && raw_last_year && parties_last_year) {
            const ly = raw_last_year.find((ly) => {
              const lyParty = parties_last_year.find(
                (lyp) => lyp.number === ly.party,
              );
              if (lyParty) {
                return matchPartyNickName(party, lyParty, true);
              }
              return false;
            });
            if (ly) {
              lyIncome =
                ly.income.candidatesMonetary +
                ly.income.candidatesNonMonetary +
                ly.income.donorsMonetary +
                ly.income.donorsNonMonetary +
                ly.income.partyMonetary +
                ly.income.partyNonMonetary +
                ly.income.mediaPackage;
            }
          }
          const prevTotalVotes = party
            ? findPrevVotes(party, priorElections?.results?.votes, true)
            : undefined;
          const totalIncome =
            r.income.candidatesMonetary +
            r.income.candidatesNonMonetary +
            r.income.donorsMonetary +
            r.income.donorsNonMonetary +
            r.income.partyMonetary +
            r.income.partyNonMonetary +
            r.income.mediaPackage;
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
            ...r,
            ...party,
            pctVotes: totalVotes
              ? (100 * (vote?.totalVotes || 0)) / totalVotes
              : undefined,
            totalVotes: vote?.totalVotes,
            totalFromParties:
              r.income.partyMonetary + r.income.partyNonMonetary,
            totalFromDonors:
              r.income.donorsMonetary + r.income.donorsNonMonetary,
            totalFromCandidates:
              r.income.candidatesMonetary + r.income.candidatesNonMonetary,
            totalMediaPackage: r.income.mediaPackage,
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
    parties_last_year,
    priorElections?.results?.votes,
    raw,
    raw_last_year,
    results.votes,
  ]);
  const columns: DataTableColumns<
    PartyIncomeRecord &
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
        cell: ({ row }) => {
          return (
            <Hint
              className="w-full"
              text={`${row.original.name || t("unknown_party")}`}
              underline={false}
            >
              <Link to={`/party/${row.original.nickName}`}>
                <div className="flex items-center border-2 border-primary">
                  <div className="w-8 font-semibold text-center">
                    {row.original.number}
                  </div>
                  <PartyLabel className="w-full pl-2" party={row.original} />
                </div>
              </Link>
            </Hint>
          );
        },
      },
      {
        accessorKey: "totalVotes",
        hidden: true,
        header: (
          <Hint text={t("total_party_votes_explainer")}>
            <div>{t("total_votes")}</div>
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
        hidden: true, //!priorElections,
        header: (
          <Hint text={t("prev_election_votes_explainer")}>
            <div>{t("prior_elections")}</div>
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
        hidden: !priorElections,
        header: (
          <Hint text={t("pct_prev_election_votes_explainer")}>
            <div>{`+/-`}</div>
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
        header: (
          <Hint text={t("source_of_income_explainer")}>
            <div>{t("source")}</div>
          </Hint>
        ) as never,
        colSpan: 4,
        hidden: !isMedium,
        id: "source",
        columns: [
          {
            header: t("parties"),
            accessorKey: "totalFromParties",
            cell: ({ row }) => (
              <div className="px-4 py-2 text-right">
                {formatThousands(row.getValue("totalFromParties"), 0)}
              </div>
            ),
          },
          {
            header: t("donors"),
            accessorKey: "totalFromDonors",
            cell: ({ row }) => (
              <div className="px-4 py-2 text-right">
                {formatThousands(row.getValue("totalFromDonors"), 0)}
              </div>
            ),
          },
          {
            header: t("candidates"),
            accessorKey: "totalFromCandidates",
            cell: ({ row }) => (
              <div className="px-4 py-2 text-right">
                {formatThousands(row.getValue("totalFromCandidates"), 0)}
              </div>
            ),
          },
          {
            header: t("media"),
            accessorKey: "totalMediaPackage",
            cell: ({ row }) => (
              <div className="px-4 py-2 text-right">
                {formatThousands(row.getValue("totalMediaPackage"), 0)}
              </div>
            ),
          },
        ],
      },
      {
        accessorKey: "totalIncome",
        header: (
          <Hint text={t("total_financing_explainer")}>
            <div>{t("income")}</div>
          </Hint>
        ) as never,
        cell: ({ row }) => (
          <div className="px-4 py-2 text-right font-bold">
            {formatThousands(row.getValue("totalIncome"), 0)}
          </div>
        ),
      },
      {
        id: "last_year",
        hidden: !raw_last_year,
        header: (
          <Hint text={t("prior_campaign_financing_explainer")}>
            {priorElections
              ? localDate(priorElections.name)
              : t("prior_campaign")}
          </Hint>
        ) as never,
        colSpan: 2,
        columns: [
          {
            accessorKey: "lyIncome",
            hidden: !priorElections,
            header: (
              <Hint text={t("total_financing_prev_campaign_explainer")}>
                <div>{t("income")}</div>
              </Hint>
            ) as never,
            cell: ({ row }) => (
              <div className="px-4 py-2 text-right">
                {formatThousands(row.getValue("lyIncome"), 0)}
              </div>
            ),
          },
          {
            accessorKey: "pctIncomeChange",
            hidden: !priorElections,
            header: (
              <Hint text={t("total_financing_ptc_change_explainer")}>
                <div>+/-</div>
              </Hint>
            ) as never,
            cell: ({ row }) => {
              const pctIncomeChange: number | undefined =
                row.getValue("pctIncomeChange");
              return (
                <div
                  className={`px-4 py-2 font-bold text-right ${pctIncomeChange && pctIncomeChange < 0 ? "text-destructive" : "text-secondary-foreground"}`}
                >
                  {formatPct(pctIncomeChange)}
                </div>
              );
            },
          },
        ],
      },
    ],
    [isMedium, priorElections, raw_last_year, t],
  );
  return (
    <div className="w-full">
      <Title className="py-8">{t("campaign_financing")}</Title>
      <DataTable
        pageSize={50}
        columns={columns}
        stickyColumn={true}
        data={data || []}
      />
    </div>
  );
};
