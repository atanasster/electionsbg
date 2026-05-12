import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { useMps } from "./useMps";
import type { MpDeclaration } from "@/data/dataTypes";
import { dataUrl } from "@/data/dataUrl";

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<[string, number | undefined]>): Promise<
  MpDeclaration[]
> => {
  const id = queryKey[1];
  if (!id) return [];
  const response = await fetch(dataUrl(`/parliament/declarations/${id}.json`));
  if (response.status === 404) return [];
  if (!response.ok) {
    throw new Error(`fetch failed: ${response.status} ${response.url}`);
  }
  return response.json();
};

export const useMpDeclarations = (name?: string | null) => {
  const { findMpByName } = useMps();
  const id = findMpByName(name)?.id;

  const { data, isLoading } = useQuery({
    queryKey: ["mp_declarations", id] as [string, number | undefined],
    queryFn,
    enabled: !!id,
    staleTime: Infinity,
  });

  return { declarations: data ?? [], isLoading };
};
