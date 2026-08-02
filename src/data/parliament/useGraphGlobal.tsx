// The down-sampled PUBLIC-figure bridge graph behind /connections' overview — served live from
// Postgres (graph_payloads 'global' blob, migrations 128/129) via /api/db/graph-global. Replaces the
// retired static /parliament/connections*.json family (person↔person). Plan:
// docs/plans/connections-engine-v1.md §P4.1.
//
// Same-origin /api/db/* (a hosting rewrite in prod; VITE_DB_API_PROXY in dev), NOT the GCS dataUrl
// seam. The route degrades a missing migration to null, which we surface as `undefined`.

import { useQuery } from "@tanstack/react-query";
import type { GraphGlobalBlob } from "./graphBlob";

const queryFn = async (): Promise<GraphGlobalBlob | undefined> => {
  const response = await fetch(`/api/db/graph-global`);
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(`fetch failed: ${response.status} ${response.url}`);
  }
  const body = (await response.json()) as GraphGlobalBlob | null;
  return body ?? undefined;
};

export const useGraphGlobal = () => {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["graph_global"] as [string],
    queryFn,
    staleTime: Infinity,
  });
  return { blob: data, isLoading, isError };
};
