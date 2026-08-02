// One person's immediate company neighbourhood (nodes + typed edges + money) — served live from
// Postgres (person_graph_ego, migration 084) via /api/db/graph-ego. Backs the /connections node-click
// drill-in and (P4.2) the per-MP mini graph. Same eligibility + Tier-V toggle as person-connections.
// Plan: docs/plans/connections-engine-v1.md §P4.1/§P4.2.
//
// `includePrivate` (?private=1) opts into the Tier-V verified-owner view. `enabled` gates the query
// so the drill-in only fetches when a node is actually selected.

import { useQuery } from "@tanstack/react-query";
import type { GraphEgo } from "./graphBlob";

const queryFn = async (
  slug: string,
  includePrivate: boolean,
): Promise<GraphEgo | null> => {
  const params = new URLSearchParams({ slug });
  if (includePrivate) params.set("private", "1");
  const response = await fetch(`/api/db/graph-ego?${params.toString()}`);
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`fetch failed: ${response.status} ${response.url}`);
  }
  return (await response.json()) as GraphEgo | null;
};

export const useGraphEgo = (
  slug: string | null,
  includePrivate: boolean,
  options?: { enabled?: boolean },
) => {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["graph_ego", slug ?? "", includePrivate] as [
      string,
      string,
      boolean,
    ],
    queryFn: () => queryFn(slug as string, includePrivate),
    enabled: (options?.enabled ?? true) && !!slug,
    staleTime: Infinity,
  });
  return { ego: data ?? undefined, isLoading, isError };
};
