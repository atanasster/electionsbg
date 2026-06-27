// Contract → originating-tender lineage for /procurement/contract/:id.
//
// A signed contract carries the procedure's ocid (ocds-e82gsb-<tenderId>). The
// tender ingest (scripts/procurement/ingest_tenders.ts) writes a compact lineage
// record per ocid, sharded by the last 2 chars of the ocid (its tenderId is
// numeric → 2-digit bucket), so we resolve "the procedure this came from" in ONE
// small fetch with no hashing and no mutation of the contracts tree.
//
// The estimated value here is the procedure's прогнозна (forecast) value — NOT
// what was contracted. The two are deliberately kept distinct (see the tile).

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import { fetchJsonMap } from "@/data/fetchJson";

export interface TenderLineageLot {
  name?: string;
  estimatedValueEur?: number;
}

export interface TenderLineage {
  unp: string;
  ocid: string;
  publicationDate: string;
  buyerEik: string;
  buyerName: string;
  subject: string;
  procedureType?: string;
  estimatedValueNative?: number;
  currency?: string;
  estimatedValueEur?: number;
  lotsCount?: number;
  isCancelled: boolean;
  linkToOjEu?: string;
  lots: TenderLineageLot[];
}

const fetchLineage = async (ocid: string): Promise<TenderLineage | null> => {
  // Shard key MUST mirror the ingest's ocidShardKey (ingest_tenders.ts) — the
  // last 2 chars of the ocid. tenderIds are 5-6 digits, so this is the last 2
  // digits; the two sides stay in lockstep by using the identical derivation.
  const shard = ocid.slice(-2);
  return fetchJsonMap<TenderLineage>(
    dataUrl(`/procurement/tenders/by-ocid/shard/${shard}.json`),
    ocid,
  );
};

const OCID_RE = /^ocds-e82gsb-\d+$/;

// Only OCDS-sourced contracts share the ocds-e82gsb-<tenderId> namespace with
// the tender feed; legacy / eop-gapfill ocids won't resolve and are skipped by
// the enabled gate.
export const useTenderLineage = (ocid?: string | null) =>
  useQuery({
    queryKey: ["procurement", "tenderLineage", ocid] as const,
    queryFn: () => fetchLineage(ocid as string),
    enabled: !!ocid && OCID_RE.test(ocid),
    staleTime: Infinity,
  });
