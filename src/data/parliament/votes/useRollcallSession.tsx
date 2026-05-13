import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import type { SessionFile } from "./types";

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<[string, string | undefined]>): Promise<
  SessionFile | undefined
> => {
  const date = queryKey[1];
  if (!date) return undefined;
  const response = await fetch(
    dataUrl(`/parliament/votes/sessions/${date}.json`),
  );
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(`fetch failed: ${response.status} ${response.url}`);
  }
  return response.json();
};

export const useRollcallSession = (date?: string | null) => {
  const { data, isLoading } = useQuery({
    queryKey: ["rollcall_session", date ?? undefined] as [
      string,
      string | undefined,
    ],
    queryFn,
    enabled: !!date,
    staleTime: Infinity,
  });

  return { session: data, isLoading };
};
