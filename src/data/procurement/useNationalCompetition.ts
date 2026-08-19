// The whole-corpus single-bid rate FOR THE CURRENT WINDOW.
//
// A sector page shows a scoped rate; putting an unscoped baseline beside it is
// not a rounding difference, it is a different sentence. Measured on culture:
// at the default parliament window the sector is 55.3% against a true national
// 47.7%, and on 2023+ the comparison SIGN-INVERTS — culture is better than the
// country and the page said worse.
//
// So the baseline travels on the same window as the figure it is compared to,
// and both are returned UN-DIVIDED so a consumer derives the two shares the same
// way.

import { useQuery } from "@tanstack/react-query";
import { useScopeWindow } from "@/data/scope/useScopeWindow";

export interface NationalCompetition {
  singleBid: number;
  bidKnown: number;
  contracts: number;
}

export const useNationalCompetition = () => {
  const { from, to } = useScopeWindow();
  return useQuery({
    queryKey: ["db", "national-competition", from, to] as const,
    queryFn: async (): Promise<NationalCompetition | null> => {
      const p = new URLSearchParams();
      if (from) p.set("from", from);
      if (to) p.set("to", to);
      const r = await fetch(`/api/db/national-competition?${p.toString()}`);
      if (!r.ok) return null;
      return r.json() as Promise<NationalCompetition>;
    },
    staleTime: Infinity,
  });
};
