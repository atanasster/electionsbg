// Per-annex breakdown for one contract (/api/db/contract-annexes →
// contract_annexes(), migration 114). The itemised modifications behind a
// contract's signing→current value move — how many annexes, each one's Δ, and
// the ЗОП ground it was made on. Answers the §0b question the net figure can't:
// one annex at the чл.116 ал.2 cap, or several summing to it?
//
// ⚠️ The EUR values are CONTRACT-TOTAL (full), matching the source, NOT the
// per-supplier split that contracts.amountEur carries — so within an annex the
// last→current progression is self-consistent, but do not compare these figures
// to a consortium contract's amountEur. See migration 114.

import { useQuery } from "@tanstack/react-query";

export type ContractAnnexRow = {
  noticeId: number | null;
  lot: string | null;
  publicationDate: string | null;
  lastValueEur: number | null;
  currentValueEur: number | null;
  valueDiffEur: number | null;
  changeReason: string | null;
  changeReasonDescription: string | null;
  changeDescription: string | null;
};

export type ContractAnnexes = {
  /** Distinct annex publications that touched this contract. */
  annexCount: number;
  rows: ContractAnnexRow[];
};

const EMPTY: ContractAnnexes = { annexCount: 0, rows: [] };

const fetchContractAnnexes = async (key: string): Promise<ContractAnnexes> => {
  const r = await fetch(
    `/api/db/contract-annexes?key=${encodeURIComponent(key)}`,
  );
  if (!r.ok) throw new Error(`fetch failed: ${r.status}`);
  return ((await r.json()) as ContractAnnexes) ?? EMPTY;
};

export const useContractAnnexes = (key?: string | null) =>
  useQuery({
    queryKey: ["procurement", "annexes", key] as const,
    queryFn: () => fetchContractAnnexes(key as string),
    enabled: !!key && /^[0-9a-f]{12}$/.test(key),
    staleTime: Infinity,
  });
