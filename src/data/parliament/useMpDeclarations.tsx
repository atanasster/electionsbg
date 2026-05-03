import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { useMps } from "./useMps";
import type { MpDeclaration } from "@/data/dataTypes";

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<[string, number | undefined]>): Promise<
  MpDeclaration[]
> => {
  const id = queryKey[1];
  if (!id) return [];
  const response = await fetch(`/parliament/declarations/${id}.json`);
  if (!response.ok) return [];
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
