import { useElectionContext } from "./ElectionContext";

export const useCountryStats = () => {
  const { priorElections } = useElectionContext();

  return {
    prevVotes: priorElections?.results?.votes,
  };
};
