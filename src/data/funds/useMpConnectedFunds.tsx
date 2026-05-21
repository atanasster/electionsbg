// SPA hook for the EU-funds MP cross-reference. Fetches the full
// mp_connected.json once (small) and shares the cache between the standalone
// /funds page and the per-candidate tile + page.
//
// If the file is absent (404) the result is empty rather than an error — the
// /update-funds skill writes it only when companies-index.json is present.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useMps } from "@/data/parliament/useMps";
import { dataUrl } from "@/data/dataUrl";
import type { FundsMpConnected, FundsMpConnectedFile } from "./types";

const fetchMpConnected = async (): Promise<FundsMpConnectedFile | null> => {
  const r = await fetch(dataUrl("/funds/derived/mp_connected.json"));
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`fetch failed: ${r.status} ${r.url}`);
  return (await r.json()) as FundsMpConnectedFile;
};

// One-time fetch — every per-MP call below shares this query cache.
export const useFundsMpConnectedFile = () =>
  useQuery({
    queryKey: ["funds", "mp_connected"] as const,
    queryFn: fetchMpConnected,
    staleTime: Infinity,
  });

export interface FundsMpConnectedSummary {
  contractCount: number;
  contractedEur: number;
  paidEur: number;
}

/** EU-funds MP cross-reference for one beneficiary EIK — which MP(s) are
 * linked to this company, and through what declared/registered relation.
 * The mirror of `useMpConnectedFunds`, keyed by the company instead of the
 * MP, for the per-company page. */
export const useFundsConnectedForEik = (
  eik?: string | null,
): { entries: FundsMpConnected[]; isLoading: boolean } => {
  const q = useFundsMpConnectedFile();
  return useMemo(() => {
    if (!eik || !q.data) {
      return { entries: [], isLoading: !!eik && q.isLoading };
    }
    return {
      entries: q.data.entries.filter((e) => e.beneficiaryEik === eik),
      isLoading: false,
    };
  }, [eik, q.data, q.isLoading]);
};

/** EU-funds beneficiaries connected to one candidate (resolved by name) plus
 * a summary rollup. Returns `entries: []` when the file is missing or the MP
 * has no connected beneficiaries. */
export const useMpConnectedFunds = (
  name?: string | null,
): {
  entries: FundsMpConnected[];
  summary: FundsMpConnectedSummary;
  isLoading: boolean;
} => {
  const { findMpByName } = useMps();
  const mpId = findMpByName(name)?.id ?? null;
  const q = useFundsMpConnectedFile();

  return useMemo(() => {
    const empty: FundsMpConnectedSummary = {
      contractCount: 0,
      contractedEur: 0,
      paidEur: 0,
    };
    if (mpId == null || !q.data) {
      return {
        entries: [],
        summary: empty,
        isLoading: mpId == null ? false : q.isLoading,
      };
    }
    const entries = q.data.entries.filter((e) => e.mpId === mpId);
    const summary: FundsMpConnectedSummary = {
      contractCount: 0,
      contractedEur: 0,
      paidEur: 0,
    };
    for (const e of entries) {
      summary.contractCount += e.contractCount;
      summary.contractedEur += e.contractedEur;
      summary.paidEur += e.paidEur;
    }
    return { entries, summary, isLoading: false };
  }, [mpId, q.data, q.isLoading]);
};
