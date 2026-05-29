import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import { useElectionContext } from "@/data/ElectionContext";
import { electionToNsFolder } from "@/data/parliament/nsFolders";
import type { SimilarityHeadlineFile, SimilarityHeadlineSlice } from "./types";

const queryFn = async (): Promise<SimilarityHeadlineFile | undefined> => {
  const response = await fetch(
    dataUrl(`/parliament/votes/derived/similarity_headline.json`),
  );
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(`fetch failed: ${response.status} ${response.url}`);
  }
  return response.json();
};

// Tiny (~1 KB gzipped total) precomputed "best cross-party MP" headline
// for the /parliament hub tile. Replaces a 1.45 MB fetch of the full
// similarity aggregate — the tile only needed one MP and three twins.
export const useSimilarityHeadline = (): {
  headline: SimilarityHeadlineSlice | undefined;
  ns: string | null;
  computedAt: string | undefined;
  isLoading: boolean;
} => {
  const { selected } = useElectionContext();
  const { data, isLoading } = useQuery({
    queryKey: ["rollcall_similarity_headline"] as [string],
    queryFn,
    staleTime: Infinity,
  });
  const ns = electionToNsFolder(selected);
  const headline = ns ? data?.byNs?.[ns] : undefined;
  return { headline, ns, computedAt: data?.computedAt, isLoading };
};
