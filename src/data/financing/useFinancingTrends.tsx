import { PartyFilingRecord, PartyInfo } from "@/data/dataTypes";
import { useElectionContext } from "@/data/ElectionContext";
import { dataUrl } from "@/data/dataUrl";
import { useQuery } from "@tanstack/react-query";

export type FinancingTrendElection = {
  name: string;
  parties: PartyInfo[];
  financing: PartyFilingRecord[];
};

// Fetch campaign-financing + party info for every election flagged
// `hasFinancials`, oldest → newest, so the trends chart can thread each party
// across the (currently three) elections that have financing data.
export const useFinancingTrends = (): FinancingTrendElection[] => {
  const { stats } = useElectionContext();
  const names = (stats ?? [])
    .filter((e) => e.hasFinancials)
    .map((e) => e.name)
    .sort();

  const { data } = useQuery({
    queryKey: ["financing_trends", names.join(",")],
    enabled: names.length > 0,
    queryFn: async (): Promise<FinancingTrendElection[]> => {
      const load = async (url: string) => {
        const res = await fetch(dataUrl(url));
        if (!res.ok) return null;
        try {
          return JSON.parse(await res.text());
        } catch {
          return null;
        }
      };
      return Promise.all(
        names.map(async (name) => {
          const [financing, parties] = await Promise.all([
            load(`/${name}/parties/financing.json`),
            load(`/${name}/cik_parties.json`),
          ]);
          return {
            name,
            parties: Array.isArray(parties) ? (parties as PartyInfo[]) : [],
            financing: Array.isArray(financing)
              ? (financing as PartyFilingRecord[])
              : [],
          };
        }),
      );
    },
  });

  return data ?? [];
};
