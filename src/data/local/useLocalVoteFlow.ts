// Local-elections vote-flow ("where did the council votes go") hook. Mirrors
// src/data/voteFlows/useVoteFlow.tsx but points at the separate
// /transitions_local/ root and is keyed by local cycle pairs instead of
// parliamentary dates.
//
// Scope is "national" or a 3-letter oblast code (BGS, SOF, …) — there's no
// Sofia MIR split for local elections (Sofia city is one oblast), so the
// multi-oblast merge the parliamentary hook needs is unnecessary here.
//
// The caller passes the selected `toCycle`; its predecessor (`from`) is
// resolved from the transitions_local index, so the earliest cycle (no
// predecessor) yields `hasPair: false` and the tile self-hides.

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import {
  VoteFlowDiagnostics,
  VoteFlowIndex,
  VoteFlowMatrix,
  VoteFlowScopeFile,
} from "@/data/voteFlows/voteFlowTypes";

const ROOT = "/transitions_local";

const indexFn = async (): Promise<VoteFlowIndex | undefined> => {
  const response = await fetch(dataUrl(`${ROOT}/index.json`));
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(`fetch failed: ${response.status} ${response.url}`);
  }
  return response.json();
};

export const useLocalVoteFlowIndex = () =>
  useQuery({ queryKey: ["localVoteFlowIndex"], queryFn: indexFn });

const scopeFn = async (
  from: string,
  to: string,
  scope: string,
): Promise<VoteFlowScopeFile | undefined> => {
  const response = await fetch(dataUrl(`${ROOT}/${from}_${to}/${scope}.json`));
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(`fetch failed: ${response.status} ${response.url}`);
  }
  return response.json();
};

type UseLocalVoteFlowResult = {
  matrix?: VoteFlowMatrix;
  diagnostics?: VoteFlowDiagnostics;
  /** Predecessor cycle resolved from the index (undefined for the earliest). */
  from?: string;
  to?: string;
  isLoading: boolean;
  /** A scope file was found for this cycle pair. */
  hasFile: boolean;
  /** A predecessor cycle exists — false for the earliest cycle. */
  hasPair: boolean;
};

/** Fetch one scope of the council vote-flow estimate for the cycle ending at
 * `toCycle`. `scope` is "national" or a 3-letter oblast code. */
export const useLocalVoteFlow = (
  toCycle: string | undefined,
  scope: string,
): UseLocalVoteFlowResult => {
  const { data: index } = useLocalVoteFlowIndex();
  const from = toCycle
    ? index?.pairs.find((p) => p.to === toCycle)?.from
    : undefined;
  const enabled = !!from && !!toCycle && !!scope;

  const query = useQuery({
    queryKey: ["localVoteFlow", from ?? "", toCycle ?? "", scope],
    queryFn: () => scopeFn(from!, toCycle!, scope),
    enabled,
    placeholderData: keepPreviousData,
  });

  return {
    matrix: query.data?.matrix,
    diagnostics: query.data?.diagnostics,
    from,
    to: toCycle,
    // Loading while the index is still in flight, or the scope file is.
    isLoading: !index || (enabled && query.isLoading),
    hasFile: !!query.data,
    hasPair: !!from,
  };
};
