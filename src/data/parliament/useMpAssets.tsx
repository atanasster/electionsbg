import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { useMpIdForName } from "@/data/candidates/CandidateMpContext";
import type { MpAssetsRollup } from "@/data/dataTypes";
import { dataUrl } from "@/data/dataUrl";

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<[string, number | undefined]>): Promise<
  MpAssetsRollup | undefined
> => {
  const id = queryKey[1];
  if (!id) return undefined;
  const response = await fetch(dataUrl(`/parliament/mp-assets/${id}.json`));
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(`fetch failed: ${response.status} ${response.url}`);
  }
  return response.json();
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
