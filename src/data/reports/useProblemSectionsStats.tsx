import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { ElectionInfo } from "../dataTypes";

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<[string]>): Promise<ElectionInfo[] | null> => {
  const response = await fetch(`/${queryKey[0]}.json`);
  if (!response.ok) return null;
  return response.json();
};

export const useProblemSectionsStats = () => {
  return useQuery({
    queryKey: ["problem_sections_stats"] as [string],
    queryFn,
    retry: false,
  });
};
