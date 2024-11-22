import { useSettlementVotes } from "@/data/useSettlementVotes";
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
  const { settlements } = useSettlementVotes();
  const votes = useMemo(
    () =>
      settlements
        ?.map((settlement) => {
          const row: SettlementReportRow | undefined = calcReportRow(
            reportRule,
            settlement.results,
            threshold,
            settlement.oblast,
            settlement.obshtina,
          );
          if (row) {
            row.ekatte = settlement.ekatte;
          }
          return row;
        })
        .filter((a) => !!a)
        .sort((a, b) => b.value - a.value),
    [reportRule, settlements, threshold],
  );
  return votes || [];
};
