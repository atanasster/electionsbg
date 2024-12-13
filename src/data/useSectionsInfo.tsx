import { useCallback } from "react";
import { SectionInfo } from "./dataTypes";
import { useSettlementVotes } from "./useSettlementVotes";
import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { useElectionContext } from "./ElectionContext";

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<[string, string | null | undefined]>): Promise<
  SectionInfo[]
> => {
  if (!queryKey[1]) {
    return [];
  }
  const response = await fetch(`/${queryKey[1]}/section_votes.json`);
  const data = await response.json();
  return data;
};

export const useSectionsInfo = () => {
  const { selected } = useElectionContext();
  const { data: sections } = useQuery({
    queryKey: ["sections", selected],
    queryFn: queryFn,
  });
  const { votesBySettlement } = useSettlementVotes();
  const findSections = useCallback(
    (ekatte?: string) => {
      const sectionCodes = ekatte ? votesBySettlement(ekatte) : undefined;
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
    (section?: string) => {
      return section ? sections?.find((s) => s.section === section) : undefined;
    },
    [sections],
  );
  return { findSections, findSection };
};
