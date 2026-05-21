// SPA hook: look up one EU-funds (ИСУН) beneficiary by EIK.
//
// The beneficiary corpus is sharded by EIK last digit
// (funds/beneficiaries/<k>.json) so the dashboard never has to load all
// ~46k rows. This hook fetches only the single shard the EIK lives in and
// finds the matching row. A missing shard/file (404) yields `null` rather
// than an error — the company simply has no EU-funds record.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import type { FundsBeneficiary } from "./types";

const fetchShard = async (
  shard: string,
): Promise<FundsBeneficiary[] | null> => {
  const r = await fetch(dataUrl(`/funds/beneficiaries/${shard}.json`));
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`fetch failed: ${r.status} ${r.url}`);
  return (await r.json()) as FundsBeneficiary[];
};

/** EU-funds beneficiary record for one EIK, or `null` when the company is
 * not in the ИСУН register. `isLoading` is false once the lookup settles. */
export const useFundsBeneficiary = (
  eik?: string | null,
): { beneficiary: FundsBeneficiary | null; isLoading: boolean } => {
  // Shard key is the EIK's last digit; only well-formed numeric EIKs resolve.
  const shard = eik && /^\d+$/.test(eik) ? eik[eik.length - 1] : null;
  const q = useQuery({
    queryKey: ["funds", "beneficiaries", shard] as const,
    queryFn: () => fetchShard(shard as string),
    enabled: shard != null,
    staleTime: Infinity,
  });

  return useMemo(() => {
    if (!eik || !q.data) {
      return { beneficiary: null, isLoading: shard != null && q.isLoading };
    }
    return {
      beneficiary: q.data.find((b) => b.eik === eik) ?? null,
      isLoading: false,
    };
  }, [eik, shard, q.data, q.isLoading]);
};
