import { useCallback } from "react";
import { SectionInfo } from "./dataTypes";
import { useAggregatedVotes } from "./useAggregatedVotes";
import { useQuery } from "@tanstack/react-query";

const queryFn = async (): Promise<SectionInfo[]> => {
  const response = await fetch("/2024_10/sections.json");
  const data = await response.json();
  return data;
};

export const useSectionsInfo = () => {
  const { data: sections } = useQuery({
    queryKey: ["sections"],
    queryFn: queryFn,
  });
  const { votesBySettlement } = useAggregatedVotes();
  const findSections = useCallback(
    (region: string, municipality: string, ekatte: string) => {
      const sectionCodes = votesBySettlement(region, municipality, ekatte);
      if (!sectionCodes) {
        return [];
      }
      return sections?.filter((s) => {
        return sectionCodes.sections.includes(s.section);
      });
    },
    [sections, votesBySettlement],
  );

  const findSection = useCallback(
    (section: string) => {
      return sections?.find((s) => s.section === section);
    },
    [sections],
  );
  return { findSections, findSection, sections };
};
