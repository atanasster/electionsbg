import { AgenciesSummary } from "@/data/dataTypes";
import { useElectionContext } from "@/data/ElectionContext";
import { dataUrl } from "@/data/dataUrl";
import { QueryFunctionContext, useQuery } from "@tanstack/react-query";

// Precomputed agencies summary (counts + multi-party vendors). Small file so
// the common dashboard doesn't download the full per-party agency list.
const queryFn = async ({
  queryKey,
}: QueryFunctionContext<
  [string, string | null | undefined]
>): Promise<AgenciesSummary | null> => {
  if (!queryKey[1]) return null;
  const res = await fetch(
    dataUrl(`/${queryKey[1]}/parties/agencies_summary.json`),
  );
  if (!res.ok) return null;
  const text = await res.text();
  try {
    const json = JSON.parse(text) as AgenciesSummary;
    return typeof json?.total === "number" ? json : null;
  } catch {
    return null;
  }
};

export const useAgenciesSummary = (): AgenciesSummary | null => {
  const { selected } = useElectionContext();
  const { data } = useQuery({
    queryKey: ["agencies_summary", selected],
    queryFn,
  });
  return data ?? null;
};
