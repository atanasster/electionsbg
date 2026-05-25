import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import { useElectionContext } from "@/data/ElectionContext";
import { electionToNsFolder } from "@/data/parliament/nsFolders";
import type {
  PartyPairBreakItem,
  PartyPairBreaksFile,
  PartyPairBreaksSlice,
} from "./types";

const queryFn = async (): Promise<PartyPairBreaksFile | undefined> => {
  const response = await fetch(
    dataUrl(`/parliament/votes/derived/party_pair_breaks.json`),
  );
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(`fetch failed: ${response.status} ${response.url}`);
  }
  return response.json();
};

const pickSlice = (
  file: PartyPairBreaksFile | undefined,
  ns: string | null,
): PartyPairBreaksSlice | undefined => {
  if (!ns) return undefined;
  return file?.byNs?.[ns];
};

// Normalize a pair key — sort the two party shorts alphabetically so the
// lookup matches regardless of which order the caller supplied. Returns the
// canonical pair key plus a swapped flag so the consumer can flip
// (voteA, voteB) labels when needed.
export const normalizePairKey = (
  a: string,
  b: string,
): { key: string; swapped: boolean } =>
  a <= b
    ? { key: `${a}__${b}`, swapped: false }
    : { key: `${b}__${a}`, swapped: true };

export const usePartyPairBreaks = (partyA: string, partyB: string) => {
  const { selected } = useElectionContext();
  const { data, isLoading } = useQuery({
    queryKey: ["rollcall_party_pair_breaks"] as [string],
    queryFn,
    staleTime: Infinity,
  });

  const ns = electionToNsFolder(selected);
  const slice = pickSlice(data, ns);

  const { items, swapped, canonicalPair } = useMemo(() => {
    const norm = normalizePairKey(partyA, partyB);
    const list: PartyPairBreakItem[] = slice?.pairs?.[norm.key] ?? [];
    return { items: list, swapped: norm.swapped, canonicalPair: norm.key };
  }, [slice, partyA, partyB]);

  return { items, swapped, canonicalPair, slice, isLoading };
};
