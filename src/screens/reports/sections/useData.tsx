import { useMemo } from "react";
import { calcReportRow, ReportRule, SectionReportRow } from "../common/utils";
import { useSectionsInfo } from "@/data/SectionsContext";
import { addVotes } from "@/data/utils";
import { VoteResults } from "@/data/dataTypes";

export type UseSectionData = (
  reportRule: ReportRule,
  threshold: number,
) => SectionReportRow[];

export const useSectionData: UseSectionData = (
  reportRule: ReportRule,
  threshold: number,
) => {
  const { sections } = useSectionsInfo();
  const votes = useMemo(
    () =>
      sections
        .map((section) => {
          const results: VoteResults = {
            actualTotal: 0,
            actualPaperVotes: 0,
            actualMachineVotes: 0,
            votes: [],
          };
          addVotes(results, section.votes || [], section.protocol);
          const row: SectionReportRow | undefined = calcReportRow(
            reportRule,
            results,
            threshold,
            section.oblast,
            section.obshtina,
          );
          if (row) {
            row.ekatte = section.ekatte;
            row.section = section.section;
            return row;
          }
          return undefined;
        })
        .filter((a) => !!a)
        .sort((a, b) => b.value - a.value),
    [reportRule, sections, threshold],
  );
  return votes;
};
