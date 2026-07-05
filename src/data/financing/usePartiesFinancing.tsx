import { PartyFilingRecord, PartyInfo } from "@/data/dataTypes";
import { useElectionContext } from "@/data/ElectionContext";
import { dataUrl } from "@/data/dataUrl";
import { usePartyInfo } from "@/data/parties/usePartyInfo";
import { totalIncomeFiling } from "@/data/utils";
import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

export type PartyFinancingRow = {
  party: number;
  info?: PartyInfo;
  fromParties: number;
  fromDonors: number;
  fromCandidates: number;
  media: number;
  total: number;
};

// Shared, guarded fetcher for `<election>/parties/financing.json`. Exported so
// FinancingTable (which registers the same "parties_financing" query key) uses
// the exact same queryFn — otherwise React Query would keep whichever queryFn
// the first observer attached, and the two must agree (incl. the dev-server
// 200-fallback guard below).
export const financingRecordsQueryFn = async ({
  queryKey,
}: QueryFunctionContext<[string, string | null | undefined]>): Promise<
  PartyFilingRecord[]
> => {
  if (!queryKey[1]) return [];
  const res = await fetch(dataUrl(`/${queryKey[1]}/parties/financing.json`));
  if (!res.ok) return [];
  const text = await res.text();
  try {
    const json = JSON.parse(text);
    return Array.isArray(json) ? (json as PartyFilingRecord[]) : [];
  } catch {
    return [];
  }
};

// The raw financing records (income + expenses per party) — shares the same
// React Query cache as usePartiesFinancing / FinancingTable.
export const useFinancingRecords = (): PartyFilingRecord[] => {
  const { selected } = useElectionContext();
  const { data } = useQuery({
    queryKey: ["parties_financing", selected],
    queryFn: financingRecordsQueryFn,
  });
  return data ?? [];
};

export const usePartiesFinancing = (): PartyFinancingRow[] => {
  const { selected } = useElectionContext();
  const { findParty } = usePartyInfo();
  const { data } = useQuery({
    queryKey: ["parties_financing", selected],
    queryFn: financingRecordsQueryFn,
  });
  return useMemo(() => {
    return (data ?? [])
      .map((r) => {
        const inc = r.filing.income;
        return {
          party: r.party,
          info: findParty(r.party),
          fromParties: inc.party.monetary + inc.party.nonMonetary,
          fromDonors: inc.donors.monetary + inc.donors.nonMonetary,
          fromCandidates: inc.candidates.monetary + inc.candidates.nonMonetary,
          media: inc.mediaPackage,
          total: totalIncomeFiling(inc),
        };
      })
      .sort((a, b) => b.total - a.total);
  }, [data, findParty]);
};
