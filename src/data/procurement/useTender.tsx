// Single tender (procedure) by УНП for /tenders/:unp.
//
// The by-tender store is sharded by sha256(УНП)[:2] (uniform spread; the raw УНП
// prefix is the buyer code → uneven). The browser computes the same prefix via
// the Web Crypto SubtleCrypto digest, so one ~1 MB shard fetch resolves any
// procedure — full subject, every lot, status, and the ocid lineage to a signed
// contract.

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import { fetchJsonMap, sha256hex } from "@/data/fetchJson";
import type { Tender, TenderLot } from "@/lib/tenderTypes";

// Re-export so existing consumers can keep importing the types from the hook.
export type { Tender, TenderLot };

const fetchTender = async (unp: string): Promise<Tender | null> => {
  const prefix = (await sha256hex(unp)).slice(0, 2);
  return fetchJsonMap<Tender>(
    dataUrl(`/procurement/tenders/by-tender/shard/${prefix}.json`),
    unp,
  );
};

const UNP_RE = /^(\d{5}-\d{4}-\d{4}|T\d+)$/i;

// УНП format: 5 digits - 4-digit year - 4-digit sequence (e.g. 00044-2025-0125),
// OR the legacy "T######" form used by ~235 procedures (the shard fetch hashes
// any УНП, so both resolve — the gate just avoids fetching on obvious garbage).
export const useTender = (unp?: string | null) =>
  useQuery({
    queryKey: ["procurement", "tender", unp] as const,
    queryFn: () => fetchTender(unp as string),
    enabled: !!unp && UNP_RE.test(unp),
    staleTime: Infinity,
  });
