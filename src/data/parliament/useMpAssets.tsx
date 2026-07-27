import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { useMpIdForName } from "@/data/candidates/CandidateMpContext";
import type { MpAssetsRollup } from "@/data/dataTypes";

// Served from Postgres (mp_assets(), migration 105) via /api/db/mp-assets — replaces the
// parliament/mp-assets/{id}.json shard (persons-pg-retirement-v1 T2.1b). Figures come from
// person_wealth_year, so they deliberately differ from the JSON (which folded company shares
// in) — the same series the wealth chart + leaderboard show. The route is slug-keyed; the ?id=
// path resolves the person from the mp id (candidate screens have no slug). A person with no
// filing (or a non-MP) yields a row with null wealth — mapped to undefined here so every
// `!rollup` fallback fires exactly as the old 404 → undefined did.
const queryFn = async ({
  queryKey,
}: QueryFunctionContext<[string, number | undefined]>): Promise<
  MpAssetsRollup | undefined
> => {
  const id = queryKey[1];
  if (!id) return undefined;
  const response = await fetch(`/api/db/mp-assets?id=${id}`);
  if (!response.ok) {
    throw new Error(`mp-assets: ${response.status} ${response.url}`);
  }
  const body = (await response.json()) as MpAssetsRollup | null;
  if (!body || body.latestDeclarationYear == null) return undefined;
  return body;
};

export const useMpAssets = (name?: string | null) => {
  const id = useMpIdForName(name) ?? undefined;

  const { data, isLoading } = useQuery({
    queryKey: ["mp_assets", id] as [string, number | undefined],
    queryFn,
    enabled: !!id,
    staleTime: Infinity,
  });

  return { rollup: data, isLoading };
};
