import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { SectionInfo } from "../dataTypes";
import { useElectionContext } from "../ElectionContext";
import { dataUrl } from "@/data/dataUrl";

export type ProblemSectionsNeighborhood = {
  id: string;
  name_bg: string;
  name_en: string;
  city_bg: string;
  city_en: string;
  source_url: string;
  sections: SectionInfo[];
};

export type ProblemSectionsReport = {
  neighborhoods: ProblemSectionsNeighborhood[];
};

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<
  [string, string | null | undefined]
>): Promise<ProblemSectionsReport | null> => {
  if (!queryKey[1]) return null;
  const response = await fetch(
    dataUrl(`/${queryKey[1]}/problem_sections.json`),
  );
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`fetch failed: ${response.status} ${response.url}`);
  }
  return response.json();
};

export const useProblemSections = (electionOverride?: string | null) => {
  const { selected } = useElectionContext();
  const election = electionOverride ?? selected;
  return useQuery({
    queryKey: ["problem_sections", election],
    queryFn,
    enabled: !!election,
    retry: false,
  });
};
