import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { PartyResultsRow } from "../dataTypes";
import { useElectionContext } from "../ElectionContext";
import { dataUrl } from "@/data/dataUrl";

type Scope = "by_region" | "by_municipality" | "by_settlement";

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<
  [string, Scope, string | null | undefined, number | null | undefined]
>): Promise<PartyResultsRow[] | null> => {
  const [, scope, election, partyNum] = queryKey;
  if (!election || !partyNum) return null;
  const response = await fetch(
    dataUrl(`/${election}/parties/${scope}/${partyNum}.json`),
  );
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`fetch failed: ${response.status} ${response.url}`);
  }
  return response.json();
};

const makeHook = (scope: Scope) => (partyNum?: number | null) => {
  const { selected } = useElectionContext();
  const { data, isLoading } = useQuery({
    queryKey: ["party_by_location", scope, selected, partyNum] as [
      string,
      Scope,
      string | null | undefined,
      number | null | undefined,
    ],
    queryFn,
    enabled: !!partyNum,
  });
  return { rows: data, isLoading };
};

export const usePartyByRegion = makeHook("by_region");
export const usePartyByMunicipality = makeHook("by_municipality");
export const usePartyBySettlement = makeHook("by_settlement");
