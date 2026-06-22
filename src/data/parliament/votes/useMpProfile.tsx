import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import { useElectionContext } from "@/data/ElectionContext";
import { electionToNsFolder } from "@/data/parliament/nsFolders";
import type { MpProfileSlice, RollcallIndexFile } from "./types";

// Same query key as useRollcallIndex — both hooks fetch the same file and
// share the cache, so calling both costs one network request.
const queryFn = async (): Promise<RollcallIndexFile | undefined> => {
  const response = await fetch(dataUrl(`/parliament/votes/index.json`));
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(`fetch failed: ${response.status} ${response.url}`);
  }
  return response.json();
};

// Returns mpNames + mpParty for the selected election's parliament — the two
// maps that every embedding / similarity / twin tile uses to resolve party
// colour and MP name when the deduped roster's id lookup misses (parliament.bg
// recycles MP ids across NSes).
//
// Source: `mpProfileByNs` embedded in `parliament/votes/index.json`. Tiles
// previously fetched the full session JSON (~100 KB) just for these two
// maps; this hook reads them straight out of the already-loaded index, saving
// the per-session fetch on every consuming surface.
export const useMpProfile = (
  enabled = true,
): {
  profile: MpProfileSlice | undefined;
  mpNames: Record<string, string>;
  mpParty: Record<string, string>;
  isLoading: boolean;
} => {
  const { selected } = useElectionContext();
  const { data, isLoading } = useQuery({
    queryKey: ["rollcall_index"] as [string],
    queryFn,
    staleTime: Infinity,
    enabled,
  });
  const ns = electionToNsFolder(selected);
  const profile = ns ? data?.mpProfileByNs?.[ns] : undefined;
  return {
    profile,
    mpNames: profile?.mpNames ?? {},
    mpParty: profile?.mpParty ?? {},
    isLoading,
  };
};
