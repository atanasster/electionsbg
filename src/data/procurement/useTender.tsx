// Single tender (procedure) by УНП for /tenders/:unp — DB-backed
// (/api/db/tender → tender_detail(), the FE Tender shape with lots + the
// signed contract(s) the procedure produced). Replaces the sha256-sharded
// tenders/by-tender JSON reader.

import { useQuery } from "@tanstack/react-query";
import type { Tender, TenderLot } from "@/lib/tenderTypes";
import type { ProcurementContractTag } from "@/data/dataTypes";

// Re-export so existing consumers can keep importing the types from the hook.
export type { Tender, TenderLot };

export type TenderAward = {
  key: string;
  // nullable — tender_award() returns raw contracts.contractor_eik (010...sql)
  contractorEik: string | null;
  contractorName: string;
  amountEur: number | null;
  dateSigned: string | null;
  tag: ProcurementContractTag;
  title: string;
};

// One КЗК (Комисия за защита на конкуренцията) appeal against this procedure,
// joined by УНП (exact). outcome/decisionDate/suspension are null until the
// tier-2 decision backfill lands.
export type TenderAppeal = {
  complaintNo: string;
  complaintDate: string | null;
  complainant: string | null;
  respondent: string | null;
  appealedAct: string | null;
  vmRequested: boolean | null;
  status: string | null;
  subject: string | null;
  outcome: string | null;
  decisionDate: string | null;
  suspension: boolean | null;
  sourceUrl: string | null;
};

export type TenderDetail = {
  tender: Tender | null;
  awards: TenderAward[];
  appeals?: TenderAppeal[];
};

const fetchTenderDetail = async (qs: string): Promise<TenderDetail> => {
  const r = await fetch(`/api/db/tender?${qs}`);
  if (!r.ok) throw new Error(`fetch failed: ${r.status}`);
  return (await r.json()) as TenderDetail;
};

// NB: the router's УНП detector (ai/orchestrator/router.ts) uses `T\d{5,}` (a
// looser word-boundary match inside free text); this anchored gate allows any
// `T\d+`. They can disagree only on implausibly short legacy IDs (real ones are
// 6-digit), so it's theoretical — keep them roughly aligned if either changes.
const UNP_RE = /^(\d{5}-\d{4}-\d{4}|T\d+)$/i;

// УНП format: 5 digits - 4-digit year - 4-digit sequence (e.g. 00044-2025-0125),
// OR the legacy "T######" form used by ~235 procedures. The gate just avoids
// fetching on obvious garbage.

/** Tender + its signed award contracts in one call (for detail screens that
 *  want the award side too). The slim tender-only `useTender` hook was removed as
 *  dead code — use this and read `.tender` if only the tender is needed. */
export const useTenderDetail = (unp?: string | null) =>
  useQuery({
    queryKey: ["procurement", "tenderDetail", unp] as const,
    queryFn: () =>
      fetchTenderDetail(`unp=${encodeURIComponent(unp as string)}`),
    enabled: !!unp && UNP_RE.test(unp),
    staleTime: Infinity,
    retry: false,
  });
