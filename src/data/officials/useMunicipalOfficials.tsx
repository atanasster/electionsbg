// SPA hook for the per-obshtina municipal roster shard. One fetch per
// municipality page, shared (via React Query dedup on a single queryKey)
// across the Mayor / Composition / Roster tiles.
//
// The 2.2 MB global data/officials/municipal/index.json is reserved for
// cross-cutting consumers (search index, future global explorer); this
// hook never touches it.

import { useQuery } from "@tanstack/react-query";
import type { MunicipalityRosterFile } from "@/data/dataTypes";
import { dataUrl } from "@/data/dataUrl";

const queryFn = async (
  obshtinaCode: string,
): Promise<MunicipalityRosterFile | null> => {
  const response = await fetch(
    dataUrl(`/officials/municipal/by_obshtina/${obshtinaCode}.json`),
  );
  // Obshtini without an entry in the registry 404 on the GCS bucket. The
  // Vite dev server returns 200 + text/html (SPA fallthrough); treat any
  // non-JSON response as a miss too. Same guard as useOfficial.tsx.
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`fetch failed: ${response.status} ${response.url}`);
  }
  if (!(response.headers.get("content-type") ?? "").includes("json")) {
    return null;
  }
  return (await response.json()) as MunicipalityRosterFile;
};

export const useMunicipalOfficials = (obshtinaCode?: string | null) => {
  const { data, isLoading } = useQuery({
    queryKey: ["municipal_officials", obshtinaCode] as const,
    queryFn: () => queryFn(obshtinaCode as string),
    enabled: !!obshtinaCode,
    staleTime: Infinity,
  });
  return {
    roster: data ?? null,
    isLoading: obshtinaCode ? isLoading : false,
  };
};
