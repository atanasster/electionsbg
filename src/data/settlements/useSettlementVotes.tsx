import { ElectionSettlement } from "../dataTypes";
import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { useElectionContext } from "../ElectionContext";

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<[string, string | null | undefined, string]>): Promise<
  ElectionSettlement | undefined
> => {
  if (!queryKey[1]) {
    return undefined;
  }
  const response = await fetch(
    `/${queryKey[1]}/settlements/${queryKey[2]}.json`,
  );
  const data = await response.json();
  return data;
};
export const useSettlementVotes = (ekatte: string) => {
  const { selected } = useElectionContext();
  const { data: settlement } = useQuery({
    queryKey: ["settlement_votes", selected, ekatte],
    queryFn,
  });

  return {
    settlement,
  };
};
