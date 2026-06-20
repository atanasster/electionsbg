// Pre-vote flow hook: the most recent PARLIAMENTARY vote before a local cycle →
// that cycle's council ballot. Mirrors useLocalVoteFlow but points at the
// /transitions_prevote/ root, where the `from` of each pair is a parliamentary
// election date (resolved from the index by the selected local `toCycle`).

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import {
  VoteFlowDiagnostics,
  VoteFlowIndex,
  VoteFlowMatrix,
  VoteFlowScopeFile,
} from "@/data/voteFlows/voteFlowTypes";

const ROOT = "/transitions_prevote";

const indexFn = async (): Promise<VoteFlowIndex | undefined> => {
  const response = await fetch(dataUrl(`${ROOT}/index.json`));
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(`fetch failed: ${response.status} ${response.url}`);
  }
  return response.json();
};

export const usePrevoteFlowIndex = () =>
  useQuery({ queryKey: ["prevoteFlowIndex"], queryFn: indexFn });

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

type UsePrevoteFlowResult = {
  matrix?: VoteFlowMatrix;
  diagnostics?: VoteFlowDiagnostics;
  /** Parliamentary election date resolved from the index (the "from" side). */
  from?: string;
  to?: string;
  isLoading: boolean;
  hasFile: boolean;
  /** A preceding parliamentary vote exists for this cycle. */
  hasPair: boolean;
};

/** Fetch one scope of the pre-vote flow estimate for the cycle ending at
 *  `toCycle`. `scope` is "national" or a 3-letter oblast code. */
export const usePrevoteFlow = (
  toCycle: string | undefined,
  scope: string,
): UsePrevoteFlowResult => {
  const { data: index } = usePrevoteFlowIndex();
  const from = toCycle
    ? index?.pairs.find((p) => p.to === toCycle)?.from
    : undefined;
  const enabled = !!from && !!toCycle && !!scope;

  const query = useQuery({
    queryKey: ["prevoteFlow", from ?? "", toCycle ?? "", scope],
    queryFn: () => scopeFn(from!, toCycle!, scope),
    enabled,
    placeholderData: keepPreviousData,
  });

  return {
    matrix: query.data?.matrix,
    diagnostics: query.data?.diagnostics,
    from,
    to: toCycle,
    isLoading: !index || (enabled && query.isLoading),
    hasFile: !!query.data,
    hasPair: !!from,
  };
};
