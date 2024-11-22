import { useMunicipalitydVotes } from "@/data/useMunicipalityVotes";
import { useMemo } from "react";
import { calcReportRow, ReportRule, ReportRow } from "../common/utils";

export const useMunicipalityData = (
  reportRule: ReportRule,
  threshold: number,
): ReportRow[] => {
  const { municipalities } = useMunicipalitydVotes();
  const votes = useMemo(
    () =>
      municipalities
        ?.map((municipality) => {
          const row: ReportRow | undefined = calcReportRow(
            reportRule,
            municipality.results,
            threshold,
            municipality.oblast,
            municipality.obshtina,
          );
          return row;
        })
        .filter((a) => !!a)
        .sort((a, b) => b.value - a.value),
    [municipalities, reportRule, threshold],
  );
  return votes || [];
};
