import { queryClient } from "./QueryProvider";
import {
  regionVotesQueryFn,
  regionVotesQueryKey,
} from "./regions/useRegionVotes";

// Warm the cache for an election the user is about to switch to.
// Safe to call repeatedly — React Query dedupes in-flight requests and
// our queries have staleTime: Infinity, so cached data is reused as-is.
export const prefetchElection = (election?: string) => {
  if (!election) return;
  queryClient.prefetchQuery({
    queryKey: regionVotesQueryKey(election),
    queryFn: regionVotesQueryFn,
  });
};
