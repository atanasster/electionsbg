// Contract → originating-tender lineage for /procurement/contract/:id —
// DB-backed (/api/db/tender?ocid= → tender_detail()). A signed contract
// carries the procedure's ocid (ocds-e82gsb-<tenderId>); the tenders table is
// indexed by ocid, so the lookup is a single index probe. Replaces the
// by-ocid JSON shard reader.
//
// The estimated value here is the procedure's прогнозна (forecast) value — NOT
// what was contracted. The two are deliberately kept distinct (see the tile).

import { useQuery } from "@tanstack/react-query";
import type { Tender } from "@/lib/tenderTypes";
import type { ProcurementContractTag } from "@/data/dataTypes";

export interface TenderLineageLot {
  name?: string;
  estimatedValueEur?: number;
}

// The signed contract(s)/award(s)/amendment(s) sharing this procedure's ocid —
// tender_detail() returns them; the gateway tile counts amendments and sums the
// signed value for the forecast-vs-actual variance without a second request.
export interface TenderLineageAward {
  key: string;
  tag: ProcurementContractTag;
  amountEur?: number;
  contractorName?: string;
  dateSigned?: string;
}

// КЗК appeals on this procedure (joined by УНП) — the tile only needs the count
// and coarse outcome for a preview; the full list lives on /tenders/:unp.
export interface TenderLineageAppeal {
  status?: string | null;
  outcome?: string | null;
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
  awards: TenderLineageAward[];
  appeals: TenderLineageAppeal[];
}

const fetchLineage = async (ocid: string): Promise<TenderLineage | null> => {
  const r = await fetch(`/api/db/tender?ocid=${encodeURIComponent(ocid)}`);
  if (!r.ok) return null;
  const j = (await r.json()) as {
    tender: Tender | null;
    awards?: TenderLineageAward[];
    appeals?: TenderLineageAppeal[];
  };
  // The full Tender shape is a superset of the lineage tile's needs. awards +
  // appeals ride in the same response — keep them for the gateway facets rather
  // than discarding them (they used to be dropped here).
  return j.tender
    ? {
        ...j.tender,
        ocid: j.tender.ocid ?? ocid,
        awards: j.awards ?? [],
        appeals: j.appeals ?? [],
      }
    : null;
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
