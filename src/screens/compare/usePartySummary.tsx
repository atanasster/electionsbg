import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import {
  PartyResultsRow,
  PreferencesInfo,
  PreferencesVotes,
} from "@/data/dataTypes";
import { useElectionContext } from "@/data/ElectionContext";

const partyResultsFn = async ({
  queryKey,
}: QueryFunctionContext<
  [string, string | null | undefined, number | null | undefined, string]
>): Promise<PartyResultsRow[] | null> => {
  const [, election, partyNum, scope] = queryKey;
  if (!election || !partyNum) return null;
  const response = await fetch(
    `/${election}/parties/${scope}/${partyNum}.json`,
  );
  if (!response.ok) return null;
  return response.json();
};

const preferenceStatsFn = async ({
  queryKey,
}: QueryFunctionContext<
  [string, string | null | undefined, number | null | undefined]
>): Promise<
  | (PreferencesVotes & {
      history: Record<string, PreferencesVotes>;
      top?: PreferencesInfo[];
    })
  | undefined
> => {
  const [, election, partyNum] = queryKey;
  if (!election || !partyNum) return undefined;
  const response = await fetch(
    `/${election}/parties/preferences/${partyNum}/stats.json`,
  );
  if (!response.ok) return undefined;
  return response.json();
};

// Fetches the three per-party JSON files needed for the comparison view.
// Each is small (a few KB), so issuing six requests in parallel for two parties
// is fine.
export const usePartySummary = (partyNum?: number) => {
  const { selected } = useElectionContext();

  const byRegion = useQuery({
    queryKey: ["party_votes_by_region", selected, partyNum, "by_region"] as [
      string,
      string | null | undefined,
      number | null | undefined,
      string,
    ],
    queryFn: partyResultsFn,
    enabled: !!partyNum,
  });

  const bySettlement = useQuery({
    queryKey: [
      "party_votes_by_settlement",
      selected,
      partyNum,
      "by_settlement",
    ] as [string, string | null | undefined, number | null | undefined, string],
    queryFn: partyResultsFn,
    enabled: !!partyNum,
  });

  const preferenceStats = useQuery({
    queryKey: ["party_preferences_stats", selected, partyNum] as [
      string,
      string | null | undefined,
      number | null | undefined,
    ],
    queryFn: preferenceStatsFn,
    enabled: !!partyNum,
    retry: false,
  });

  return {
    byRegion: byRegion.data,
    bySettlement: bySettlement.data,
    preferenceStats: preferenceStats.data,
    isLoading:
      byRegion.isLoading || bySettlement.isLoading || preferenceStats.isLoading,
  };
};
