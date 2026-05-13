// Top-level procurement index + the top-contractors list. Both come from
// small files (a few KB), so we just fetch them as-is rather than sharding.

import { useQuery } from "@tanstack/react-query";
import type {
  ProcurementIndexFile,
  ProcurementTopContractorsFile,
} from "@/data/dataTypes";
import { dataUrl } from "@/data/dataUrl";

const fetchIndex = async (): Promise<ProcurementIndexFile | null> => {
  const r = await fetch(dataUrl("/procurement/index.json"));
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`fetch failed: ${r.status} ${r.url}`);
  return (await r.json()) as ProcurementIndexFile;
};

const fetchTop = async (): Promise<ProcurementTopContractorsFile | null> => {
  const r = await fetch(dataUrl("/procurement/derived/top_contractors.json"));
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`fetch failed: ${r.status} ${r.url}`);
  return (await r.json()) as ProcurementTopContractorsFile;
};

export const useProcurementIndex = () =>
  useQuery({
    queryKey: ["procurement", "index"] as const,
    queryFn: fetchIndex,
    staleTime: Infinity,
  });

export const useTopContractors = () =>
  useQuery({
    queryKey: ["procurement", "top_contractors"] as const,
    queryFn: fetchTop,
    staleTime: Infinity,
  });
