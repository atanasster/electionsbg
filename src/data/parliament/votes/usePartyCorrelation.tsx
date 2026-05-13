import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import { useElectionContext } from "@/data/ElectionContext";
import { electionToNsFolder } from "@/data/parliament/nsFolders";
import type { PartyCorrelationFile, PartyCorrelationSlice } from "./types";

const queryFn = async (): Promise<PartyCorrelationFile | undefined> => {
  const response = await fetch(
    dataUrl(`/parliament/votes/derived/party_correlation.json`),
  );
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(`fetch failed: ${response.status} ${response.url}`);
  }
  return response.json();
};

// Returns the correlation slice for the currently-selected election's NS, or
// undefined when no slice exists. Strict — we don't fall back to a different
// NS because the homepage is election-scoped (e.g. selecting the 50th NS view
// shouldn't surface 52nd NS group correlations).
export const usePartyCorrelation = () => {
  const { selected } = useElectionContext();
  const { data, isLoading } = useQuery({
    queryKey: ["rollcall_party_correlation"] as [string],
    queryFn,
    staleTime: Infinity,
  });

  const ns = electionToNsFolder(selected);
  const slice: PartyCorrelationSlice | undefined = ns
    ? data?.byNs?.[ns]
    : undefined;

  return {
    file: slice,
    slice,
    computedAt: data?.computedAt,
    ns,
    isLoading,
  };
};
