import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { useMps } from "./useMps";
import type { MpManagementFile } from "@/data/dataTypes";

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<
  [string, number | undefined]
>): Promise<MpManagementFile | null> => {
  const id = queryKey[1];
  if (!id) return null;
  const response = await fetch(`/parliament/mp-management/${id}.json`);
  if (!response.ok) return null;
  return response.json();
};

export const useMpManagement = (name?: string | null) => {
  const { findMpByName } = useMps();
  const id = findMpByName(name)?.id;

  const { data, isLoading } = useQuery({
    queryKey: ["mp_management", id] as [string, number | undefined],
    queryFn,
    enabled: !!id,
    staleTime: Infinity,
  });

  return { management: data ?? null, isLoading };
};
