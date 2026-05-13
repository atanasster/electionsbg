// Fetches the full Contract[] for one contractor (by EIK) from
// data/procurement/contractor_contracts/<EIK>.json. Used by the company
// detail page to render the contracts table. Lazy fetched — the rollup
// header + by-year totals come from useContractor() first; this hook only
// loads when the contracts tile renders.

import { useQuery } from "@tanstack/react-query";
import type { ProcurementContractorContractsFile } from "@/data/dataTypes";
import { dataUrl } from "@/data/dataUrl";

const fetchContractorContracts = async (
  eik: string,
): Promise<ProcurementContractorContractsFile | null> => {
  const r = await fetch(
    dataUrl(`/procurement/contractor_contracts/${eik}.json`),
  );
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`fetch failed: ${r.status} ${r.url}`);
  return (await r.json()) as ProcurementContractorContractsFile;
};

export const useContractorContracts = (eik?: string | null) =>
  useQuery({
    queryKey: ["procurement", "contractor_contracts", eik] as const,
    queryFn: () => fetchContractorContracts(eik as string),
    enabled: !!eik && /^\d{9,13}$/.test(eik),
    staleTime: Infinity,
  });
