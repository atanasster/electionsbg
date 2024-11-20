import { useAggregatedVotes } from "@/data/AggregatedVotesHook";
import { useMemo } from "react";
import {
  calcReportRow,
  ReportRule,
  SettlementReportRow,
} from "../common/utils";

export type UseSettlementData = (
  reportRule: ReportRule,
  threshold: number,
) => SettlementReportRow[];

export const useSettlementData: UseSettlementData = (
  reportRule: ReportRule,
  threshold: number,
): SettlementReportRow[] => {
  const { regions } = useAggregatedVotes();
  const votes = useMemo(
    () =>
      regions
        .reduce((acc: SettlementReportRow[], region) => {
          return [
            ...acc,
            ...region.municipalities.reduce(
              (acc: SettlementReportRow[], municipality) => {
                return [
                  ...acc,
                  ...municipality.settlements.reduce(
                    (acc: SettlementReportRow[], settlement) => {
                      const row: SettlementReportRow | undefined =
                        calcReportRow(
                          reportRule,
                          settlement.results,
                          threshold,
                          region.key,
                          municipality.obshtina,
                        );
                      if (row) {
                        row.ekatte = settlement.ekatte;
                        return [...acc, row];
                      }
                      return acc;
                    },
                    [],
                  ),
                ];
              },

              [],
            ),
          ];
        }, [])
        .sort((a, b) => b.value - a.value),
    [regions, reportRule, threshold],
  );
  return votes;
};
