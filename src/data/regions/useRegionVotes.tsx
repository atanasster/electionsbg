import { useCallback } from "react";
import {
  ElectionRegions,
  ElectionRegion,
  VoteResults,
  SOFIA_REGIONS,
} from "../dataTypes";
import { addResults } from "../utils";
import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { useElectionContext } from "../ElectionContext";

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<
  [string, string | null | undefined]
>): Promise<ElectionRegions> => {
  if (!queryKey[1]) {
    return [];
  }
  const response = await fetch(`/${queryKey[1]}/region_votes.json`);
  const data = await response.json();
  return data;
};
export const useRegionVotes = () => {
  const { selected } = useElectionContext();
  const { data: votes } = useQuery({
    queryKey: ["region_votes", selected],
    queryFn,
  });
  const votesByRegion = useCallback(
    (regionCode: string): ElectionRegion | undefined => {
      return votes?.find((vote) => vote.key === regionCode);
    },
    [votes],
  );

  const votesWorld = useCallback((): ElectionRegion | undefined => {
    return votes?.find((vote) => vote.key === "32");
  }, [votes]);

  const votesSofia = useCallback((): VoteResults | undefined => {
    return votes?.reduce((acc: VoteResults, v) => {
      if (SOFIA_REGIONS.includes(v.key)) {
        addResults(acc, v.results.votes, v.results.protocol);
      }
      return acc;
    }, {} as VoteResults);
  }, [votes]);
  const countryRegions = useCallback((): ElectionRegion[] | undefined => {
    return votes?.filter((vote) => vote.key !== "32");
  }, [votes]);
  const sofiaRegions = useCallback((): ElectionRegion[] | undefined => {
    return votes?.filter((v) => SOFIA_REGIONS.includes(v.key));
  }, [votes]);
  const countryVotes = useCallback(() => {
    const acc: VoteResults = {
      votes: [],
    };
    if (votes) {
      votes.map((r) => {
        addResults(acc, r.results.votes, r.results.protocol);
      });
    }

    return acc;
  }, [votes]);

  return {
    countryRegions,
    votesByRegion,
    votesWorld,
    votesSofia,
    countryVotes,
    sofiaRegions,
    votes,
  };
};
