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

export const useAssetsRankings = (options?: { enabled?: boolean }) => {
  const { data, isLoading } = useQuery({
    queryKey: ["mp_assets_rankings"] as [string],
    queryFn,
    staleTime: Infinity,
    enabled: options?.enabled ?? true,
  });
  return { rankings: data, isLoading };
};

// Top-50 slim variant. Use from dashboard tiles that render only the top 5
// rows. PartyMpAssetsTile and useMpScorecard still need the full file —
// they look up specific MPs that may be far down the list.
const queryFnTop = async (): Promise<MpAssetsRankings | undefined> => {
  const response = await fetch(dataUrl(`/parliament/assets-rankings-top.json`));
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(`fetch failed: ${response.status} ${response.url}`);
  }
  return response.json();
};

export const useAssetsRankingsTop = (options?: { enabled?: boolean }) => {
  const { data, isLoading } = useQuery({
    queryKey: ["mp_assets_rankings_top"] as [string],
    queryFn: queryFnTop,
    staleTime: Infinity,
    enabled: options?.enabled ?? true,
  });
  return { rankings: data, isLoading };
};
