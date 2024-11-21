import { useAggregatedVotes } from "@/data/useAggregatedVotes";
import { useMemo } from "react";
import { calcReportRow, ReportRule, ReportRow } from "../common/utils";

export const useMunicipalityData = (
  reportRule: ReportRule,
  threshold: number,
): ReportRow[] => {
  const { regions } = useAggregatedVotes();
  const votes = useMemo(
    () =>
      regions
        ? regions
            .reduce((acc: ReportRow[], region) => {
              return [
                ...acc,
                ...region.municipalities.reduce(
                  (acc: ReportRow[], municipality) => {
                    const row: ReportRow | undefined = calcReportRow(
                      reportRule,
                      municipality.results,
                      threshold,
                      region.key,
                      municipality.obshtina,
                    );
                    if (row) {
                      return [...acc, row];
                    }
                    return acc;
                  },

                  [],
                ),
              ];
            }, [])
            .sort((a, b) => b.value - a.value)
        : [],
    [regions, reportRule, threshold],
  );
  return votes;
};
