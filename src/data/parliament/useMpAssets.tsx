import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { useMps } from "./useMps";
import type { MpAssetsRollup } from "@/data/dataTypes";

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<[string, number | undefined]>): Promise<
  MpAssetsRollup | undefined
> => {
  const id = queryKey[1];
  if (!id) return undefined;
  const response = await fetch(`/parliament/mp-assets/${id}.json`);
  if (!response.ok) return undefined;
  return response.json();
};

export const useMpAssets = (name?: string | null) => {
  const { findMpByName } = useMps();
  const id = findMpByName(name)?.id;

  const { data, isLoading } = useQuery({
    queryKey: ["mp_assets", id] as [string, number | undefined],
    queryFn,
    enabled: !!id,
    staleTime: Infinity,
  });

  return { rollup: data, isLoading };
};
