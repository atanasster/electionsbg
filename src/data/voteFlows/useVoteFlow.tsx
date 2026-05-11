import { keepPreviousData, useQueries, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  VoteFlowDiagnostics,
  VoteFlowIndex,
  VoteFlowMatrix,
  VoteFlowScopeFile,
} from "./voteFlowTypes";
import { dataUrl } from "@/data/dataUrl";

const indexQueryFn = async (): Promise<VoteFlowIndex | undefined> => {
  const response = await fetch(dataUrl(`/transitions/index.json`));
  if (!response.ok) return undefined;
  return response.json();
};

export const useVoteFlowIndex = () =>
  useQuery({ queryKey: ["voteFlowIndex"], queryFn: indexQueryFn });

const scopeFn = async (
  from: string,
  to: string,
  scope: string,
): Promise<VoteFlowScopeFile | undefined> => {
  const response = await fetch(
    dataUrl(`/transitions/${from}_${to}/${scope}.json`),
  );
  if (!response.ok) return undefined;
  return response.json();
};

/** Scope of the requested matrix. The hook fetches exactly the file(s)
 * needed — never the full cycle pair — so a dashboard tile loads ~12KB
 * for the national view and ~8KB per oblast instead of ~436KB. */
export type VoteFlowScope =
  | { kind: "national" }
  | { kind: "oblast"; mir: string }
  | { kind: "oblasts"; mirs: readonly string[] };

const sumMatrices = (mats: VoteFlowMatrix[]): VoteFlowMatrix | undefined => {
  if (!mats.length) return undefined;
  if (mats.length === 1) return mats[0];
  const first = mats[0];
  const fromVotesById = new Map<string, number>();
  const toVotesById = new Map<string, number>();
  const flowMap = new Map<string, number>();
  for (const m of mats) {
    for (const n of m.fromNodes) {
      fromVotesById.set(n.id, (fromVotesById.get(n.id) ?? 0) + n.votes);
    }
    for (const n of m.toNodes) {
      toVotesById.set(n.id, (toVotesById.get(n.id) ?? 0) + n.votes);
    }
    for (const f of m.flows) {
      const key = `${f.from}::${f.to}`;
      flowMap.set(key, (flowMap.get(key) ?? 0) + f.votes);
    }
  }
  return {
    fromNodes: first.fromNodes.map((n) => ({
      ...n,
      votes: fromVotesById.get(n.id) ?? 0,
    })),
    toNodes: first.toNodes.map((n) => ({
      ...n,
      votes: toVotesById.get(n.id) ?? 0,
    })),
    flows: Array.from(flowMap.entries()).map(([key, votes]) => {
      const [from, to] = key.split("::");
      return { from, to, votes };
    }),
  };
};

type UseVoteFlowResult = {
  matrix?: VoteFlowMatrix;
  diagnostics?: VoteFlowDiagnostics;
  isLoading: boolean;
  hasFile: boolean;
};

/** Fetch only the scope(s) actually rendered. `oblasts` mode runs the
 * fetches in parallel through React Query and merges them client-side. */
export const useVoteFlow = (
  from: string | undefined,
  to: string | undefined,
  scope: VoteFlowScope,
): UseVoteFlowResult => {
  const enabled = !!from && !!to;
  // We always run BOTH `useQuery` (single-scope) and `useQueries`
  // (multi-scope) — React requires hook-call order to be stable across
  // renders, so we can't switch between them based on scope.kind. The
  // disabled side is a no-op.
  const singleScope =
    scope.kind === "national"
      ? "national"
      : scope.kind === "oblast"
        ? scope.mir
        : null;

  // `placeholderData: keepPreviousData` keeps the previously-fetched matrix
  // visible while a new election's data is in flight. Without it, switching
  // election years briefly drops the matrix to undefined and the tile
  // collapses to a tiny loading placeholder, jolting the page layout.
  const single = useQuery({
    queryKey: ["voteFlow", from ?? "", to ?? "", singleScope ?? ""],
    queryFn: () => scopeFn(from!, to!, singleScope!),
    enabled: enabled && !!singleScope,
    placeholderData: keepPreviousData,
  });

  const multiMirs = scope.kind === "oblasts" ? scope.mirs : [];
  const multi = useQueries({
    queries: multiMirs.map((mir) => ({
      queryKey: ["voteFlow", from ?? "", to ?? "", mir],
      queryFn: () => scopeFn(from!, to!, mir),
      enabled: enabled && scope.kind === "oblasts",
      placeholderData: keepPreviousData,
    })),
  });

  // `multi` returns a fresh array each render; key the memo on a stable
  // signature so it only recomputes when actual payloads/state change.
  const multiSignature = multi
    .map((q) => `${q.data?.scope ?? ""}:${q.isLoading ? "L" : "R"}`)
    .join("|");
  return useMemo<UseVoteFlowResult>(() => {
    if (scope.kind === "oblasts") {
      const isLoading = multi.some((q) => q.isLoading);
      const files = multi
        .map((q) => q.data)
        .filter((f): f is VoteFlowScopeFile => !!f);
      const matrix = sumMatrices(files.map((f) => f.matrix));
      return {
        matrix,
        diagnostics: undefined,
        isLoading,
        hasFile: files.length > 0,
      };
    }
    return {
      matrix: single.data?.matrix,
      diagnostics: single.data?.diagnostics,
      isLoading: single.isLoading,
      hasFile: !!single.data,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [single.data, single.isLoading, scope.kind, multiSignature]);
};
