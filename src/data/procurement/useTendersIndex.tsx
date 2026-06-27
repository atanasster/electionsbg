// Tender-stage (procedures) index for the /procurement/tenders surface.
// Reads the headline file written by scripts/procurement/ingest_tenders.ts.
//
// Every value here is ESTIMATED (прогнозна стойност) — a forecast, NOT money
// spent. The screen labels it as such and never sums it into contracted totals.

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import { fetchJsonSoft } from "@/data/fetchJson";

export interface TenderSlim {
  unp: string;
  ocid?: string;
  publicationDate: string;
  buyerEik: string;
  buyerName: string;
  subject: string;
  estimatedValueEur?: number;
  currency?: string;
  lotsCount?: number;
  isCancelled: boolean;
  nuts?: string;
}

export interface TendersIndex {
  generatedAt: string;
  source: string;
  valueSemantics: string;
  coverage: { firstDay: string; lastDay: string; months: string[] };
  totals: {
    procedures: number;
    lots: number;
    cancelled: number;
    withEstimate: number;
    estimatedValueEur: number;
  };
  byYear: Array<{
    year: string;
    procedures: number;
    cancelled: number;
    estimatedValueEur: number;
  }>;
  byProcedureType: Array<{
    type: string;
    procedures: number;
    estimatedValueEur: number;
  }>;
  topByValue: TenderSlim[];
  buyers: Array<{
    eik: string;
    name: string;
    procedures: number;
    cancelled: number;
    estimatedValueEur: number;
  }>;
}

// Soft-miss (null) on a 404 / dev SPA-HTML fallback, like the sibling tender
// hooks — the index is the file most likely to 404 on a fresh clone before
// `bucket:sync`, and the screen already guards `!idx`.
const fetchTendersIndex = (): Promise<TendersIndex | null> =>
  fetchJsonSoft<TendersIndex>(dataUrl("/procurement/tenders/index.json"));

export const useTendersIndex = () =>
  useQuery({
    queryKey: ["procurement", "tendersIndex"] as const,
    queryFn: fetchTendersIndex,
    staleTime: Infinity,
  });
