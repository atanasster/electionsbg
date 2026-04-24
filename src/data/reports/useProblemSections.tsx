import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { SectionInfo } from "../dataTypes";
import { useElectionContext } from "../ElectionContext";

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
  const response = await fetch(`/${queryKey[1]}/problem_sections.json`);
  if (!response.ok) return null;
  return response.json();
};

export const useProblemSections = () => {
  const { selected } = useElectionContext();
  return useQuery({
    queryKey: ["problem_sections", selected],
    queryFn,
    enabled: !!selected,
    retry: false,
  });
};
