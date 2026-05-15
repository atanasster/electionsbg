// SPA hook for the officials assets ranking. Mirrors useAssetsRankings on
// the MP side. Single fetch (~50 KB) cached for the session.

import { useQuery } from "@tanstack/react-query";
import type { OfficialAssetsRankings } from "@/data/dataTypes";
import { dataUrl } from "@/data/dataUrl";

const queryFn = async (): Promise<OfficialAssetsRankings | undefined> => {
  const response = await fetch(dataUrl(`/officials/assets-rankings.json`));
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(`fetch failed: ${response.status} ${response.url}`);
  }
  return response.json();
};

export const useOfficialsRankings = () => {
  const { data, isLoading } = useQuery({
    queryKey: ["officials_assets_rankings"] as [string],
    queryFn,
    staleTime: Infinity,
  });
  return { rankings: data, isLoading };
};
