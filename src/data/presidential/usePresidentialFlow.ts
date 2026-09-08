// Presidential vote-flow hook: the parliamentary vote AT OR BEFORE a presidential cycle → one
// ROUND of that cycle's ballot. Mirrors `usePrevoteFlow` and points at the
// `/transitions_presidential/` root, whose pairs are keyed `<cycle>_tur<round>`.
//
// ⚠ THE ROUND IS PART OF THE KEY, NOT A SECOND PARAMETER TO THE FILE. Round 1 and the runoff
// are different ballots with different candidate sets — 2021's runoff has two tickets where
// round one had twenty-three — so they are two pairs in the index rather than two views of one.
//
// ⚠ ABSENT IS THE ORDINARY ANSWER FOR THREE OF THE FIVE CYCLES, and for three different
// reasons: 2001 has no parliamentary election before it in the corpus, 2006's sections join at
// 66% and the producer REFUSES below its floor (`parl_presidential_index.ts`), and
// `data/*_pvr` reaches the bucket only through `bucket:gz`. The tile self-hides in all three —
// a heading over „no estimate" would report the corpus's ordinary silence as a defect.

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import {
  VoteFlowDiagnostics,
  VoteFlowIndex,
  VoteFlowMatrix,
  VoteFlowScopeFile,
} from "@/data/voteFlows/voteFlowTypes";

const ROOT = "/transitions_presidential";

/** The index key for one cycle-round — the directory is `<from>_<this>`. */
export const presidentialFlowKey = (cycle: string, round: 1 | 2): string =>
  `${cycle}_tur${round}`;

const indexFn = async (): Promise<VoteFlowIndex | undefined> => {
  const response = await fetch(dataUrl(`${ROOT}/index.json`));
  if (response.status === 404) return undefined;
  if (!response.ok)
    throw new Error(`fetch failed: ${response.status} ${response.url}`);
  return response.json();
};

export const usePresidentialFlowIndex = () =>
  useQuery({ queryKey: ["presidentialFlowIndex"], queryFn: indexFn });

const scopeFn = async (
  from: string,
  to: string,
  scope: string,
): Promise<VoteFlowScopeFile | undefined> => {
  const response = await fetch(dataUrl(`${ROOT}/${from}_${to}/${scope}.json`));
  if (response.status === 404) return undefined;
  if (!response.ok)
    throw new Error(`fetch failed: ${response.status} ${response.url}`);
  return response.json();
};

export type UsePresidentialFlowResult = {
  matrix?: VoteFlowMatrix;
  diagnostics?: VoteFlowDiagnostics;
  /** The parliamentary election the flow starts from, resolved from the index. */
  from?: string;
  isLoading: boolean;
  hasFile: boolean;
  /** A pair exists for this cycle-round — false where there is no „from", or the producer
   *  refused the join. */
  hasPair: boolean;
};

/** One scope of the estimate for `cycle`'s `round`. `scope` is "national" or a presidential
 *  oblast code (`PDV`, `PDV-00`, `S23`…). */
export const usePresidentialFlow = (
  cycle: string | undefined,
  round: 1 | 2,
  scope: string,
): UsePresidentialFlowResult => {
  const { data: index } = usePresidentialFlowIndex();
  const to = cycle ? presidentialFlowKey(cycle, round) : undefined;
  const from = to ? index?.pairs.find((p) => p.to === to)?.from : undefined;
  const enabled = !!from && !!to && !!scope;

  const query = useQuery({
    queryKey: ["presidentialFlow", from ?? "", to ?? "", scope],
    queryFn: () => scopeFn(from!, to!, scope),
    enabled,
    placeholderData: keepPreviousData,
  });

  return {
    matrix: query.data?.matrix,
    diagnostics: query.data?.diagnostics,
    from,
    isLoading: !index || (enabled && query.isLoading),
    hasFile: !!query.data,
    hasPair: !!from,
  };
};
