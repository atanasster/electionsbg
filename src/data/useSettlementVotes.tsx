import { useCallback } from "react";
import { ElectionSettlement } from "./dataTypes";
import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { useElectionContext } from "./ElectionContext";

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<[string, string | null | undefined]>): Promise<
  ElectionSettlement[]
> => {
  if (!queryKey[1]) {
    return [];
  }
  const response = await fetch(`/${queryKey[1]}/settlement_votes.json`);
  const data = await response.json();
  return data;
};
export const useSettlementVotes = () => {
  const { selected } = useElectionContext();
  const { data: settlements } = useQuery({
    queryKey: ["settlement_votes", selected],
    queryFn,
  });
  const votesBySettlement = useCallback(
    (ekatte?: string) => {
      return ekatte ? settlements?.find((s) => s.ekatte === ekatte) : undefined;
    },
    [settlements],
  );

  return {
    votesBySettlement,
  };
};
