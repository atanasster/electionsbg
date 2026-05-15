// SPA hook for the АОП debarred-suppliers register. Tiny file (single-digit
// kB), fetched once and indexed by both EIK (rare — most entries lack one,
// only ones we've enriched from PDFs carry it) and folded contractor name so
// procurement rows can be checked against it client-side without a join in
// the data pipeline.
//
// Name folding mirrors scripts/procurement/debarred.ts → normalizeName(): we
// re-implement it here rather than ship the function across the SPA/Node
// boundary because the rule is short and the two sides change rarely.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { DebarredEntry, DebarredFile } from "@/data/dataTypes";
import { dataUrl } from "@/data/dataUrl";

const LEGAL_SUFFIX_RE =
  /\s*[„"„“(]?(ЕООД|ООД|ЕАД|АД|ЕТ|СД|КД|КДА|ДЗЗД|АДСИЦ|ООД-К|ЕООД-К)\.?[)"”]?\s*$/iu;

/** Same fold as the scraper. Strip decoration + legal-form suffix → lowercase
 *  Bulgarian. Both contractor names and debarred-list names go through this
 *  before comparison, so a contract row whose name carries an extra " or
 *  ЕООД still matches. */
export const normalizeContractorName = (raw: string): string => {
  let s = raw.normalize("NFC").trim();
  s = s.replace(/[„"„“”""''`’‘()]/g, "");
  s = s.replace(LEGAL_SUFFIX_RE, "");
  s = s.replace(/\s+/g, " ").trim();
  return s.toLocaleLowerCase("bg");
};

const fetchDebarred = async (): Promise<DebarredFile | null> => {
  const response = await fetch(dataUrl("/procurement/debarred.json"));
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`fetch failed: ${response.status} ${response.url}`);
  }
  return (await response.json()) as DebarredFile;
};

export type DebarredIndex = {
  list: DebarredEntry[];
  /** Lookup by folded contractor name → the most-recent (highest publishedAt)
   *  matching entry. */
  byName: Map<string, DebarredEntry>;
};

const EMPTY: DebarredIndex = { list: [], byName: new Map() };

export const useDebarred = (): {
  debarred: DebarredIndex;
  isLoading: boolean;
} => {
  const { data, isLoading } = useQuery({
    queryKey: ["procurement_debarred"] as const,
    queryFn: fetchDebarred,
    staleTime: Infinity,
  });

  const debarred = useMemo<DebarredIndex>(() => {
    if (!data) return EMPTY;
    const byName = new Map<string, DebarredEntry>();
    for (const e of data.entries) {
      const prior = byName.get(e.nameNormalized);
      if (!prior || prior.publishedAt < e.publishedAt) {
        byName.set(e.nameNormalized, e);
      }
    }
    return { list: data.entries, byName };
  }, [data]);

  return { debarred, isLoading };
};
