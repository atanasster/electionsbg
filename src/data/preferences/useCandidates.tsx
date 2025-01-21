import { useCallback } from "react";
import { CandidatesInfo } from "../dataTypes";
import { useElectionContext } from "../ElectionContext";
import { QueryFunctionContext, useQuery } from "@tanstack/react-query";

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<[string, string | null | undefined]>): Promise<
  CandidatesInfo[] | undefined
> => {
  if (!queryKey[1]) {
    return undefined;
  }
  const response = await fetch(`/${queryKey[1]}/candidates.json`);
  const data = await response.json();
  return data;
};

export const useCandidates = () => {
  const { selected } = useElectionContext();
  const { data } = useQuery({
    queryKey: ["candidates", selected],
    queryFn: queryFn,
  });
  const findCandidate = useCallback(
    (region: string, partyNum: number, pref: string) => {
      return data?.find(
        (d) =>
          d.oblast === region && d.partyNum === partyNum && d.pref === pref,
      );
    },
    [data],
  );

  return {
    findCandidate,
  };
};
