// SPA hook for the curated journalism cross-reference (funds/confirmed.json) —
// the small hand-maintained set of EU-funds beneficiaries that investigative
// journalism named and whose grant the ИСУН register corroborates.
//
// A missing file (404) yields null rather than an error — the dataset is
// optional and only present once curated.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import type { FundsConfirmedFile, FundsConfirmedCase } from "./types";

const fetchConfirmed = async (): Promise<FundsConfirmedFile | null> => {
  const r = await fetch(dataUrl("/funds/confirmed.json"));
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`fetch failed: ${r.status} ${r.url}`);
  return (await r.json()) as FundsConfirmedFile;
};

export const useFundsConfirmedFile = () =>
  useQuery({
    queryKey: ["funds", "confirmed"] as const,
    queryFn: fetchConfirmed,
    staleTime: Infinity,
  });

/** The curated journalism case that names this company (by EIK), if any. */
export const useFundsConfirmedCase = (
  eik?: string | null,
): { caseData: FundsConfirmedCase | null; isLoading: boolean } => {
  const q = useFundsConfirmedFile();
  return useMemo(() => {
    if (!eik || !q.data) {
      return { caseData: null, isLoading: !!eik && q.isLoading };
    }
    const match = q.data.cases.find((c) =>
      c.beneficiaries.some((b) => b.eik === eik),
    );
    return { caseData: match ?? null, isLoading: false };
  }, [eik, q.data, q.isLoading]);
};
