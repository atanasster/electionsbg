import { useCallback } from "react";
import {
  ElectionRegions,
  ElectionRegion,
  VoteResults,
  SOFIA_REGIONS,
  RecountOriginal,
} from "../dataTypes";
import { addRecounts, addResults, initializeRecount } from "../utils";
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
  const { selected, electionStats } = useElectionContext();
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

  const votesSofia = useCallback(():
    | { results: VoteResults; original: RecountOriginal }
    | undefined => {
    return votes?.reduce(
      (
        {
          results,
          original,
        }: { results: VoteResults; original: RecountOriginal },
        v,
      ) => {
        if (SOFIA_REGIONS.includes(v.key)) {
          addResults(results, v.results.votes, v.results.protocol);
          if (electionStats?.hasRecount && v.original) {
            addRecounts({
              dest: original,
              src: v.original,
            });
          }
        }
        return { results, original };
      },
      { results: { votes: [] }, original: initializeRecount() },
    );
  }, [electionStats?.hasRecount, votes]);

  const countryRegions = useCallback((): ElectionRegion[] | undefined => {
    return votes?.filter((vote) => vote.key !== "32");
  }, [votes]);
  const sofiaRegions = useCallback((): ElectionRegion[] | undefined => {
    return votes?.filter((v) => SOFIA_REGIONS.includes(v.key));
  }, [votes]);
  const countryVotes = useCallback(() => {
    const results: VoteResults = {
      votes: [],
    };
    const original = initializeRecount();

    if (votes) {
      votes.map((r) => {
        addResults(results, r.results.votes, r.results.protocol);
        if (electionStats?.hasRecount && r.original) {
          addRecounts({
            src: r.original,
            dest: original,
          });
        }
      });
    }
    return { results, original };
  }, [electionStats?.hasRecount, votes]);

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
