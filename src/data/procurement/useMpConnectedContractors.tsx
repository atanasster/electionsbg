// Set of contractor EIKs whose declared officers / owners include an MP.
// Reuses the same /procurement/derived/mp_connected.json that
// useMpConnectedContracts already fetches (shared React Query cache via the
// shared key) so this hook is a free join on top of an existing payload.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  ProcurementMpConnectedContractor,
  ProcurementMpConnectedFile,
} from "@/data/dataTypes";
import { dataUrl } from "@/data/dataUrl";

const fetchFile = async (): Promise<ProcurementMpConnectedFile | null> => {
  const response = await fetch(
    dataUrl("/procurement/derived/mp_connected.json"),
  );
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`fetch failed: ${response.status} ${response.url}`);
  }
  return (await response.json()) as ProcurementMpConnectedFile;
};

export type MpConnectedContractorsIndex = {
  /** Contractor EIK → list of MP entries on the contractor side. */
  byContractorEik: Map<string, ProcurementMpConnectedContractor[]>;
};

const EMPTY: MpConnectedContractorsIndex = { byContractorEik: new Map() };

export const useMpConnectedContractors = (): {
  index: MpConnectedContractorsIndex;
  isLoading: boolean;
} => {
  const { data, isLoading } = useQuery({
    queryKey: ["procurement", "mp_connected"] as const,
    queryFn: fetchFile,
    staleTime: Infinity,
  });

  const index = useMemo<MpConnectedContractorsIndex>(() => {
    if (!data) return EMPTY;
    const byContractorEik = new Map<
      string,
      ProcurementMpConnectedContractor[]
    >();
    for (const e of data.entries) {
      const list = byContractorEik.get(e.contractorEik) ?? [];
      list.push(e);
      byContractorEik.set(e.contractorEik, list);
    }
    return { byContractorEik };
  }, [data]);

  return { index, isLoading };
};
