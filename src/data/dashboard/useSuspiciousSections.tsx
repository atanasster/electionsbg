import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { useElectionContext } from "../ElectionContext";

export type SuspiciousTopSettlement = {
  ekatte: string;
  oblast: string;
  obshtina?: string;
  settlement?: string;
  settlement_en?: string;
  region_name?: string;
  region_name_en?: string;
  value: number;
  partyNum?: number;
  partyVotes?: number;
};

export type SuspiciousCategory = {
  count: number;
  threshold: number;
  top: SuspiciousTopSettlement[];
};

export type SuspiciousSettlementsReport = {
  election: string;
  thresholds: {
    concentratedPct: number;
    invalidBallotsPct: number;
    additionalVotersPct: number;
    additionalVotersMinActual: number;
  };
  concentrated: SuspiciousCategory;
  invalidBallots: SuspiciousCategory;
  additionalVoters: SuspiciousCategory;
};

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<
  [string, string | null | undefined]
>): Promise<SuspiciousSettlementsReport | null> => {
  if (!queryKey[1]) return null;
  const response = await fetch(
    `/${queryKey[1]}/dashboard/suspicious_settlements.json`,
  );
  if (!response.ok) return null;
  return response.json();
};

export const useSuspiciousSettlements = () => {
  const { selected } = useElectionContext();
  return useQuery({
    queryKey: ["suspicious_settlements", selected],
    queryFn,
    enabled: !!selected,
    retry: false,
  });
};
