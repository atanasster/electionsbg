// SPA hook for the officials assets ranking. Mirrors useAssetsRankings on
// the MP side. Single fetch cached for the session.

import { useQuery } from "@tanstack/react-query";
import type {
  OfficialAssetsRankingEntry,
  OfficialAssetsRankings,
} from "@/data/dataTypes";
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

// Top-50 slim variant — drops byCategory. Use from the /governance dashboard
// tile that renders only the top 5. The /officials/assets explorer and
// /officials/:slug detail page still consume the full file via the hook
// above (they need byCategory filtering and per-slug lookups).
export type OfficialsRankingsTop = {
  generatedAt: string;
  years: number[];
  total: number;
  topOfficials: OfficialAssetsRankingEntry[];
};

const queryFnTop = async (): Promise<OfficialsRankingsTop | undefined> => {
  const response = await fetch(dataUrl(`/officials/assets-rankings-top.json`));
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(`fetch failed: ${response.status} ${response.url}`);
  }
  return response.json();
};

export const useOfficialsRankingsTop = () => {
  const { data, isLoading } = useQuery({
    queryKey: ["officials_assets_rankings_top"] as [string],
    queryFn: queryFnTop,
    staleTime: Infinity,
  });
  return { rankings: data, isLoading };
};
