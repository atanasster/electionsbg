import { FC } from "react";
import { Building2, ChartColumn, Vote } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AccordionSummary } from "@/ux/AccordionSummary";
import { ProtocolCard } from "@/ux/ProtocolCard";
import { CandidateHistoryChart } from "./CandidateHistoryChart";
import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { CandidateStats } from "@/data/dataTypes";
import { useElectionContext } from "@/data/ElectionContext";
import { HintedDataItem } from "@/ux/HintedDataItem";
import { formatFloat } from "@/data/utils";
import { SettlementLink } from "../settlements/SettlementLink";
import { SectionLink } from "../sections/SectionLink";

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<
  [string, string | null | undefined, string | undefined]
>): Promise<CandidateStats | null> => {
  if (!queryKey[1] || !queryKey[2]) {
    return null;
  }
  const response = await fetch(
    `/${queryKey[1]}/candidates/${queryKey[2]}/preferences_stats.json`,
  );
  const data = await response.json();
  return data;
};

export const CandidateSummary: FC<{
  name: string;
}> = ({ name }) => {
  const { t } = useTranslation();
  const { selected } = useElectionContext();
  const { data: stats } = useQuery({
    queryKey: ["candidate_preferences_stats", selected, name],
    queryFn,
  });
  return stats ? (
    <AccordionSummary>
      <div className={`grid gap-4 sm:grid-cols-2 lg:grid-cols-3 my-4`}>
        <ProtocolCard icon={<ChartColumn />} title={t("preferences_history")}>
          <CandidateHistoryChart stats={stats.stats} />
        </ProtocolCard>

        <ProtocolCard
          icon={<Building2 />}
          title={`${t("top")} ${t("settlements")}`}
        >
          {stats.top_settlements.slice(0, 7).map((p) => {
            return (
              <HintedDataItem
                key={`item_settlement_${p.ekatte}`}
                value={p.totalVotes}
                pctChange={
                  p.partyVotes
                    ? formatFloat((100 * p.totalVotes) / p.partyVotes)
                    : undefined
                }
                pctStyle="plain"
                valueLabel={<SettlementLink ekatte={p.ekatte} />}
              />
            );
          })}
        </ProtocolCard>
        <ProtocolCard icon={<Vote />} title={`${t("top")} ${t("sections")}`}>
          {stats.top_sections.slice(0, 7).map((p) => {
            return (
              <HintedDataItem
                key={`item_settlement_${p.section}`}
                value={p.totalVotes}
                pctChange={
                  p.partyVotes
                    ? formatFloat((100 * p.totalVotes) / p.partyVotes)
                    : undefined
                }
                pctStyle="plain"
                valueLabel={<SectionLink section={p.section} />}
              />
            );
          })}
        </ProtocolCard>
      </div>
    </AccordionSummary>
  ) : null;
};
