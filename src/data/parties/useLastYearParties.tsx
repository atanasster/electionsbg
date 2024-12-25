import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { PartyInfo } from "../dataTypes";
import { useElectionContext } from "../ElectionContext";
import { useCallback } from "react";
import { matchPartyNickName } from "../utils";

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<[string, string | null | undefined]>): Promise<
  PartyInfo[]
> => {
  if (!queryKey[1]) {
    return [];
  }
  const response = await fetch(`/${queryKey[1]}/cik_parties.json`);
  const data = await response.json();
  return data;
};

export const useLastYearParties = () => {
  const { priorElections } = useElectionContext();

  const { data: parties } = useQuery({
    queryKey: ["parties_prev_year", priorElections?.name],
    queryFn,
    enabled: !!priorElections,
  });
  const partyByNickName = useCallback(
    (nickName?: string) =>
      parties?.find((p) => matchPartyNickName({ nickName }, p, true)),
    [parties],
  );

  return { partyByNickName, parties };
};
