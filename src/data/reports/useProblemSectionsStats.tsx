import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { ElectionInfo } from "../dataTypes";
import { dataUrl } from "@/data/dataUrl";

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<[string]>): Promise<ElectionInfo[] | null> => {
  const response = await fetch(dataUrl(`/${queryKey[0]}.json`));
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`fetch failed: ${response.status} ${response.url}`);
  }
  return response.json();
};

export const useProblemSectionsStats = () => {
  return useQuery({
    queryKey: ["problem_sections_stats"] as [string],
    queryFn,
    retry: false,
  });
};
