// SPA hook for the АОП debarred-suppliers register — DB-backed via the shared
// risk-indexes payload (useRiskIndexes → /api/db/procurement-risk-indexes).
// The register is tiny and NAME-ONLY; entries are indexed by folded contractor
// name so procurement rows can be checked client-side in O(1).
//
// Name folding mirrors scripts/procurement/debarred.ts → normalizeName(): we
// re-implement it here rather than ship the function across the SPA/Node
// boundary because the rule is short and the two sides change rarely.

import { useMemo } from "react";
import type { DebarredEntry } from "@/data/dataTypes";
import { useRiskIndexes } from "./useRiskIndexes";

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
  const { data, isLoading } = useRiskIndexes();

  const debarred = useMemo<DebarredIndex>(() => {
    if (!data) return EMPTY;
    const list: DebarredEntry[] = data.debarred.entries.map((e) => ({
      name: e.name,
      nameNormalized: normalizeContractorName(e.name),
      publishedAt: e.publishedAt ?? "",
      debarredUntil: e.debarredUntil ?? "",
      detailsUrl: e.detailsUrl,
    }));
    const byName = new Map<string, DebarredEntry>();
    for (const e of list) {
      const prior = byName.get(e.nameNormalized);
      if (!prior || prior.publishedAt < e.publishedAt) {
        byName.set(e.nameNormalized, e);
      }
    }
    return { list, byName };
  }, [data]);

  return { debarred, isLoading };
};
