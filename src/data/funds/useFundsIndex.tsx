// EU-funds (ИСУН) index — corpus totals, by-org-type / by-org-form
// breakdowns, top beneficiaries, and the MP cross-reference summary.
// Small file; fetched as-is. Renders nothing-friendly: 404 → null.

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import type { FundsIndexFile } from "./types";

const fetchIndex = async (): Promise<FundsIndexFile | null> => {
  const r = await fetch(dataUrl("/funds/index.json"));
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`fetch failed: ${r.status} ${r.url}`);
  return (await r.json()) as FundsIndexFile;
};

export const useFundsIndex = () =>
  useQuery({
    queryKey: ["funds", "index"] as const,
    queryFn: fetchIndex,
    staleTime: Infinity,
  });
