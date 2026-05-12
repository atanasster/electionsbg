import { useQuery } from "@tanstack/react-query";
import type { MpAssetsRankings } from "@/data/dataTypes";
import { dataUrl } from "@/data/dataUrl";

const queryFn = async (): Promise<MpAssetsRankings | undefined> => {
  const response = await fetch(dataUrl(`/parliament/assets-rankings.json`));
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(`fetch failed: ${response.status} ${response.url}`);
  }
  return response.json();
};

export const useAssetsRankings = () => {
  const { data, isLoading } = useQuery({
    queryKey: ["mp_assets_rankings"] as [string],
    queryFn,
    staleTime: Infinity,
  });
  return { rankings: data, isLoading };
};
