// SPA hook: look up one EU-funds (ИСУН) beneficiary by EIK.
//
// Reads the per-EIK file funds/beneficiaries-by-eik/{eik}.json — one small
// JSON per company — so the /company/{EIK} page fetches ~300 bytes instead of
// a ~1.5 MB beneficiary shard. A missing file (404) yields `null`: the
// company simply has no ИСУН record.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import type { FundsBeneficiary } from "./types";

const fetchBeneficiary = async (
  eik: string,
): Promise<FundsBeneficiary | null> => {
  const r = await fetch(dataUrl(`/funds/beneficiaries-by-eik/${eik}.json`));
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`fetch failed: ${r.status} ${r.url}`);
  return (await r.json()) as FundsBeneficiary;
};

/** EU-funds beneficiary record for one EIK, or `null` when the company is
 * not in the ИСУН register. `isLoading` is false once the lookup settles. */
export const useFundsBeneficiary = (
  eik?: string | null,
): { beneficiary: FundsBeneficiary | null; isLoading: boolean } => {
  const valid = !!eik && /^\d+$/.test(eik);
  const q = useQuery({
    queryKey: ["funds", "beneficiary", eik] as const,
    queryFn: () => fetchBeneficiary(eik as string),
    enabled: valid,
    staleTime: Infinity,
  });
  return useMemo(
    () => ({ beneficiary: q.data ?? null, isLoading: valid && q.isLoading }),
    [q.data, q.isLoading, valid],
  );
};
