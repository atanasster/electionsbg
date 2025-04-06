import { FC } from "react";
import { PartyInfo } from "@/data/dataTypes";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { ChartArea, Heart, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { HintedDataItem } from "@/ux/HintedDataItem";
import { AccordionSummary } from "@/ux/AccordionSummary";
import { useElectionContext } from "@/data/ElectionContext";
import { pctChange } from "@/data/utils";
import { ProtocolCard } from "@/ux/ProtocolCard";
import { TopCandidatesChart } from "./TopCandidatesChart";
import { usePreferencesStats } from "./data/usePreferencesStats";
import { PartyPreferencesHistoryChart } from "./PartyPreferencesHistoryChart";

export const PartyCandidatesSummary: FC<{
  party: PartyInfo;
}> = ({ party }) => {
  const { priorElections } = useElectionContext();
  const stats = usePreferencesStats(party);
  const lyVotes = priorElections
    ? stats?.history[priorElections.name]
    : undefined;
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
              pctChange={pctChange(stats?.totalVotes, lyVotes?.totalVotes)}
              size="xl"
              pctSuffix=""
              valueExplainer={t("party_preferences_explainer")}
              pctExplainer={t("party_preferences_pct_change_explainer")}
            />

            <HintedDataItem
              value={stats?.paperVotes}
              decimals={0}
              pctChange={pctChange(stats?.paperVotes, lyVotes?.paperVotes)}
              valueLabel={t("paper_votes")}
              valueExplainer={t("party_paper_preferences_explainer")}
              pctExplainer={t("party_paper_preferences_pct_change_explainer")}
            />
            <HintedDataItem
              value={stats?.machineVotes}
              decimals={0}
              pctChange={pctChange(stats?.machineVotes, lyVotes?.machineVotes)}
              valueLabel={t("machine_votes")}
              valueExplainer={t("party_machine_preferences_explainer")}
              pctExplainer={t("party_machine_preferences_pct_change_explainer")}
            />
          </CardContent>
        </Card>
        {stats?.top && (
          <ProtocolCard icon={<Users />} title={t("top_candidates")}>
            <TopCandidatesChart party={party} maxRows={8} />
          </ProtocolCard>
        )}
        <ProtocolCard icon={<ChartArea />} title={t("preferences_history")}>
          <PartyPreferencesHistoryChart party={party} />
        </ProtocolCard>
      </div>
    </AccordionSummary>
  );
};
