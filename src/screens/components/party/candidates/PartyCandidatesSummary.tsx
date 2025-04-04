import { FC } from "react";
import { PartyInfo, PreferencesVotes } from "@/data/dataTypes";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { Heart } from "lucide-react";
import { useTranslation } from "react-i18next";
import { HintedDataItem } from "@/ux/HintedDataItem";
import { AccordionSummary } from "@/ux/AccordionSummary";
import { useElectionContext } from "@/data/ElectionContext";
import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { localDate, pctChange } from "@/data/utils";
const queryFn = async ({
  queryKey,
}: QueryFunctionContext<[string, string | null | undefined, number]>): Promise<
  PreferencesVotes | undefined
> => {
  if (!queryKey[1]) {
    return undefined;
  }
  const response = await fetch(
    `/${queryKey[1]}/parties/preferences/${queryKey[2]}/stats.json`,
  );
  const data = await response.json();
  return data;
};

export const PartyCandidatesSummary: FC<{
  party: PartyInfo;
}> = ({ party }) => {
  const { selected, priorElections } = useElectionContext();
  const { data: stats } = useQuery({
    queryKey: ["party_preferences_stats", selected, party.number],
    queryFn,
  });
  console.log(stats);
  const { t } = useTranslation();
  return (
    <AccordionSummary>
      <div className={`grid gap-4 sm:grid-cols-2 lg:grid-cols-3 my-4`}>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-md font-medium">
              {t("preferences")}
            </CardTitle>
            <Heart />
          </CardHeader>
          <CardContent>
            <HintedDataItem
              value={stats?.totalVotes}
              decimals={0}
              pctChange={pctChange(stats?.totalVotes, stats?.lyTotalVotes)}
              size="xl"
              pctSuffix=""
              valueExplainer={t("raised_funds_explainer")}
              pctExplainer={t("raised_funds_pct_change_explainer")}
            />

            <HintedDataItem
              value={stats?.paperVotes}
              decimals={0}
              pctChange={pctChange(stats?.paperVotes, stats?.lyPaperVotes)}
              valueLabel={t("paper_votes")}
            />
            <HintedDataItem
              value={stats?.machineVotes}
              decimals={0}
              pctChange={pctChange(stats?.machineVotes, stats?.lyMachineVotes)}
              valueLabel={t("machine_votes")}
            />
          </CardContent>
        </Card>
        {!!stats?.lyTotalVotes && priorElections && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-md font-medium">
                {localDate(priorElections.name)}
              </CardTitle>
              <Heart />
            </CardHeader>
            <CardContent>
              <HintedDataItem
                value={stats.lyTotalVotes}
                decimals={0}
                /* pctChange={pctChange(
                totalIncomeFiling(filing?.income),
                totalIncomeFiling(priorFiling?.income),
              )} */
                size="xl"
                pctSuffix=""
                valueExplainer={t("raised_funds_explainer")}
                pctExplainer={t("raised_funds_pct_change_explainer")}
              />

              <HintedDataItem
                value={stats.lyPaperVotes}
                decimals={0}
                /* pctChange={pctChange(
                totalFinancing(filing?.income.donors),
                totalFinancing(priorFiling?.income.donors),
              )} */
                valueLabel={t("paper_votes")}
              />
              <HintedDataItem
                value={stats.lyMachineVotes}
                decimals={0}
                /* pctChange={pctChange(
                totalFinancing(filing?.income.candidates),
                totalFinancing(priorFiling?.income.candidates),
              )} */
                valueLabel={t("machine_votes")}
              />
            </CardContent>
          </Card>
        )}
      </div>
    </AccordionSummary>
  );
};
