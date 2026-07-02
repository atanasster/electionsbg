// Single tender (procedure) by УНП for /tenders/:unp — DB-backed
// (/api/db/tender → tender_detail(), the FE Tender shape with lots + the
// signed contract(s) the procedure produced). Replaces the sha256-sharded
// tenders/by-tender JSON reader.

import { useQuery } from "@tanstack/react-query";
import type { Tender, TenderLot } from "@/lib/tenderTypes";

// Re-export so existing consumers can keep importing the types from the hook.
export type { Tender, TenderLot };

export type TenderAward = {
  key: string;
  contractorEik: string;
  contractorName: string;
  amountEur: number | null;
  dateSigned: string | null;
  tag: string;
  title: string;
};

export type TenderDetail = { tender: Tender | null; awards: TenderAward[] };

const fetchTenderDetail = async (qs: string): Promise<TenderDetail> => {
  const r = await fetch(`/api/db/tender?${qs}`);
  if (!r.ok) throw new Error(`fetch failed: ${r.status}`);
  return (await r.json()) as TenderDetail;
};

const UNP_RE = /^(\d{5}-\d{4}-\d{4}|T\d+)$/i;

// УНП format: 5 digits - 4-digit year - 4-digit sequence (e.g. 00044-2025-0125),
// OR the legacy "T######" form used by ~235 procedures. The gate just avoids
// fetching on obvious garbage.
export const useTender = (unp?: string | null) =>
  useQuery({
    queryKey: ["procurement", "tender", unp] as const,
    queryFn: async () =>
      (await fetchTenderDetail(`unp=${encodeURIComponent(unp as string)}`))
        .tender,
    enabled: !!unp && UNP_RE.test(unp),
    staleTime: Infinity,
  });

/** Tender + its signed award contracts in one call (for detail screens that
 *  want the award side too). */
export const useTenderDetail = (unp?: string | null) =>
  useQuery({
    queryKey: ["procurement", "tenderDetail", unp] as const,
    queryFn: () =>
      fetchTenderDetail(`unp=${encodeURIComponent(unp as string)}`),
    enabled: !!unp && UNP_RE.test(unp),
    staleTime: Infinity,
  });
