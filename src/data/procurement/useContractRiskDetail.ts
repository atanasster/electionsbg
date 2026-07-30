// Per-flag supporting detail for ONE contract, fetched on demand.
//
// The chips themselves come from the row's own masks (src/lib/contractRiskMask.ts)
// and cost nothing. What a bit cannot carry is the tooltip's contents — which MP,
// what concentration share, the debarment dates — and those used to arrive inside
// the 1.29 MB corpus-wide risk-indexes payload, downloaded by every visitor to
// render a handful of hovers on one page.
//
// `enabled` is the whole design: the caller passes `false` until the tooltip is
// actually opened, so a page render issues zero requests and a hover issues one
// small one. React Query caches per contract for the session, so re-opening the
// same tooltip is free.

import { useQuery } from "@tanstack/react-query";

export type ContractRiskDetail = {
  debarred: {
    name: string;
    publishedAt: string | null;
    debarredUntil: string | null;
    detailsUrl: string | null;
  } | null;
  mpConnected: { mpId: number; mpName: string }[] | null;
  concentration: {
    sharePct: number;
    awarderTotalEur: number;
    pairTotalEur: number;
    contractCount: number;
    awarderName: string | null;
    contractorName: string | null;
  } | null;
  founded: { foundedDate: string | null; newFirmMonths: number | null } | null;
  splitPurchase: {
    contractCount: number;
    totalEur: number;
    ceilingEur: number;
    cpvDiv: string | null;
    year: string | null;
  } | null;
};

const fetchDetail = async (key: string): Promise<ContractRiskDetail | null> => {
  const r = await fetch(
    `/api/db/contract-risk-detail?key=${encodeURIComponent(key)}`,
  );
  // THROW, do not return null. `null` is a real answer here — "this contract has
  // no supporting detail" — so swallowing a 429 or a 500 as null would cache a
  // transport failure as fact for the whole session, and the tooltip would stay
  // permanently empty with nothing to retry. /api/db is rate-limited and this
  // fires on hover, so 429 is the realistic case. Matches useContract.tsx, whose
  // comment already says these two must not diverge.
  if (!r.ok) throw new Error(`contract-risk-detail: ${r.status}`);
  const j = (await r.json()) as { detail: ContractRiskDetail | null };
  return j.detail ?? null;
};

/**
 * @param key      contract key, or null/undefined to stand down
 * @param enabled  pass `true` only once the tooltip is open — the point is that a
 *                 table of 100 rows fires no requests until someone hovers.
 */
export const useContractRiskDetail = (key?: string | null, enabled = false) =>
  useQuery({
    queryKey: ["contract-risk-detail", key] as const,
    queryFn: () => fetchDetail(key as string),
    enabled: !!key && enabled,
    staleTime: Infinity,
    retry: false,
  });
