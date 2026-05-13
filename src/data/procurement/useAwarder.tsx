// Awarder rollup + per-awarder contracts file. Mirrors useContractor.tsx +
// useContractorContracts.tsx but keyed on the buyer side of each contract.

import { useQuery } from "@tanstack/react-query";
import type {
  ProcurementAwarderContractsFile,
  ProcurementAwarderRollup,
} from "@/data/dataTypes";
import { dataUrl } from "@/data/dataUrl";

const fetchAwarder = async (
  eik: string,
): Promise<ProcurementAwarderRollup | null> => {
  const r = await fetch(dataUrl(`/procurement/awarders/${eik}.json`));
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`fetch failed: ${r.status} ${r.url}`);
  return (await r.json()) as ProcurementAwarderRollup;
};

const fetchAwarderContracts = async (
  eik: string,
): Promise<ProcurementAwarderContractsFile | null> => {
  const r = await fetch(dataUrl(`/procurement/awarder_contracts/${eik}.json`));
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`fetch failed: ${r.status} ${r.url}`);
  return (await r.json()) as ProcurementAwarderContractsFile;
};

export const useAwarder = (eik?: string | null) =>
  useQuery({
    queryKey: ["procurement", "awarder", eik] as const,
    queryFn: () => fetchAwarder(eik as string),
    enabled: !!eik && /^\d{9,13}$/.test(eik),
    staleTime: Infinity,
  });

export const useAwarderContracts = (eik?: string | null) =>
  useQuery({
    queryKey: ["procurement", "awarder_contracts", eik] as const,
    queryFn: () => fetchAwarderContracts(eik as string),
    enabled: !!eik && /^\d{9,13}$/.test(eik),
    staleTime: Infinity,
  });
