import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import { useElectionContext } from "@/data/ElectionContext";
import { electionToNsFolder } from "@/data/parliament/nsFolders";
import type { EmbeddingFile, EmbeddingSlice } from "./types";

const queryFn = async (): Promise<EmbeddingFile | undefined> => {
  const response = await fetch(
    dataUrl(`/parliament/votes/derived/embedding.json`),
  );
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(`fetch failed: ${response.status} ${response.url}`);
  }
  return response.json();
};

// Strict: return data only for the requested NS. Older elections (pre-roll-
// call cycles) have no slice, and falling back to a different NS would paint
// the wrong people (parliament.bg recycles ids across NSes) and the wrong
// party affiliations.
const pickSlice = (
  file: EmbeddingFile | undefined,
  ns: string | null,
): EmbeddingSlice | undefined => {
  if (!ns) return undefined;
  return file?.byNs?.[ns];
};

export const useMpEmbedding = () => {
  const { selected } = useElectionContext();
  const { data, isLoading } = useQuery({
    queryKey: ["rollcall_embedding"] as [string],
    queryFn,
    staleTime: Infinity,
  });
  const ns = electionToNsFolder(selected);
  const slice = pickSlice(data, ns);
  return {
    file: slice,
    slice,
    computedAt: data?.computedAt,
    ns,
    points: slice?.points ?? [],
    isLoading,
  };
};
