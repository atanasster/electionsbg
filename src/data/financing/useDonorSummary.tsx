import { DonorSummary } from "@/data/dataTypes";
import { useElectionContext } from "@/data/ElectionContext";
import { dataUrl } from "@/data/dataUrl";
import { QueryFunctionContext, useQuery } from "@tanstack/react-query";

// National donor summary for the selected election (leaderboard + per-party
// concentration + cross-party donors). Precomputed at ingest, see
// scripts/smetna_palata/donor_summary.ts.
const queryFn = async ({
  queryKey,
}: QueryFunctionContext<
  [string, string | null | undefined]
>): Promise<DonorSummary | null> => {
  if (!queryKey[1]) return null;
  const res = await fetch(dataUrl(`/${queryKey[1]}/parties/donors.json`));
  if (!res.ok) return null;
  const text = await res.text();
  try {
    const json = JSON.parse(text) as DonorSummary;
    // Guard against the dev-server SPA fallback returning index.html as 200.
    return typeof json?.totalDonations === "number" ? json : null;
  } catch {
    return null;
  }
};

export const useDonorSummary = (): DonorSummary | null => {
  const { selected } = useElectionContext();
  const { data } = useQuery({ queryKey: ["donor_summary", selected], queryFn });
  return data ?? null;
};
