// Per-contractor rollup at data/procurement/contractors/<EIK>.json. Returns
// null for unknown EIKs (the 404 path), so the screen can render a NotFound.

import { useQuery } from "@tanstack/react-query";
import type { ProcurementContractorRollup } from "@/data/dataTypes";
import { dataUrl } from "@/data/dataUrl";

const fetchContractor = async (
  eik: string,
): Promise<ProcurementContractorRollup | null> => {
  const r = await fetch(dataUrl(`/procurement/contractors/${eik}.json`));
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`fetch failed: ${r.status} ${r.url}`);
  return (await r.json()) as ProcurementContractorRollup;
};

export const useContractor = (eik?: string | null) =>
  useQuery({
    queryKey: ["procurement", "contractor", eik] as const,
    queryFn: () => fetchContractor(eik as string),
    enabled: !!eik && /^\d{9,13}$/.test(eik),
    staleTime: Infinity,
  });
