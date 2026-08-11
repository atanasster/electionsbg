import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import { useElectionContext } from "@/data/ElectionContext";
import { electionToNsFolder } from "@/data/parliament/nsFolders";
import {
  buildPairSeries,
  movementFor,
  parliamentsIn,
  type PairMovement,
  type PairSeries,
} from "./partyPairs";
import type { PartyCorrelationFile, PartyCorrelationSlice } from "./types";

// ONE query key for both hooks below, and that is the whole performance story: the file is
// 17 KB carrying all nine parliaments, so the history costs no fetch at all — React Query
// hands the second consumer the same cached object. A separate key here would double the
// download to serve data the page already had.
const QUERY_KEY = ["rollcall_party_correlation"] as [string];

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
    queryKey: QUERY_KEY,
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

export interface PartyCorrelationHistory {
  /** Every pair's arc, keyed by pair id. */
  series: Map<string, PairSeries>;
  /** The selected parliament's pairs, biggest move first. */
  movement: PairMovement[];
  /** The x-axis: every parliament the file covers, ascending. */
  parliaments: string[];
  ns: string | null;
  isLoading: boolean;
}

// The cross-parliament view of the SAME file. Deliberately NOT election-scoped the way
// usePartyCorrelation is — the point of an arc is that it crosses parliaments — but the
// selected NS is still returned, because it is what the movement board is computed for and
// what the chart marks.
export const usePartyCorrelationHistory = (): PartyCorrelationHistory => {
  const { selected } = useElectionContext();
  const { data, isLoading } = useQuery({
    queryKey: QUERY_KEY,
    queryFn,
    staleTime: Infinity,
  });
  const ns = electionToNsFolder(selected);

  const series = useMemo(() => buildPairSeries(data), [data]);
  const movement = useMemo(() => movementFor(series, ns), [series, ns]);
  const parliaments = useMemo(() => parliamentsIn(data), [data]);

  return { series, movement, parliaments, ns, isLoading };
};
